import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/db.js';
import { recordEvents, withEvents } from '../../src/lib/events.js';
import { backoffMs, dispatchAll, dispatchTenant } from '../../src/lib/outbox.js';
import { handleDomainEvent } from '../../src/services/notifications/notifier.js';
import { raiseHelp } from '../../src/services/safety/loneWork.js';
import { postOffer } from '../../src/services/shiftboard/offers.js';
import { app, owner, seedTenant } from './fixtures.js';

let t: Awaited<ReturnType<typeof seedTenant>>;
/** A second runtime connection pool: a second dispatcher, as if in another process. */
const app2 = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });

const page = (message: string) => ({ type: 'frontdesk.page' as const, tenantId: t.tenant.id, facilityId: t.facility.id, fromUserId: t.users[0]!.id, message });
const events = (where: object = {}) => owner.eventOutbox.findMany({ where: { tenantId: t.tenant.id, ...where }, orderBy: { createdAt: 'asc' } });
const clear = () => owner.eventOutbox.deleteMany({ where: { tenantId: t.tenant.id } });

beforeAll(async () => {
  t = await seedTenant('outbox', 2);
  // The page goes to head guards.
  await owner.user.update({ where: { id: t.users[1]!.id }, data: { roles: ['HEAD_LIFEGUARD'] } });
});
afterAll(async () => {
  await app.$disconnect();
  await app2.$disconnect();
  await owner.$disconnect();
});

describe('event outbox', () => {
  it('writes the event in the same transaction as the change', async () => {
    await clear();
    const before = await owner.timeOffRequest.count({ where: { tenantId: t.tenant.id } });
    await withTenant(
      t.tenant.id,
      async (tx) => {
        await tx.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, type: 'VACATION', startsAt: new Date('2027-01-04'), endsAt: new Date('2027-01-05') } });
        await recordEvents(tx, page('one'));
        // Not visible outside the transaction until it commits.
        expect(await owner.eventOutbox.count({ where: { tenantId: t.tenant.id } })).toBe(0);
      },
      { prisma: app },
    );
    expect(await owner.timeOffRequest.count({ where: { tenantId: t.tenant.id } })).toBe(before + 1);
    const [e] = await events();
    expect(e).toMatchObject({ type: 'frontdesk.page', status: 'PENDING', attempts: 0 });
    expect(e!.payload).toMatchObject({ message: 'one' });
  });

  it('a rolled-back transaction leaves neither the change nor its event', async () => {
    await clear();
    const before = await owner.timeOffRequest.count({ where: { tenantId: t.tenant.id } });
    await expect(
      withTenant(
        t.tenant.id,
        async (tx) => {
          await tx.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, type: 'VACATION', startsAt: new Date('2027-02-04'), endsAt: new Date('2027-02-05') } });
          await withEvents(tx, { events: [page('never')] });
          throw new Error('boom');
        },
        { prisma: app },
      ),
    ).rejects.toThrow('boom');
    expect(await owner.timeOffRequest.count({ where: { tenantId: t.tenant.id } })).toBe(before);
    expect(await events()).toHaveLength(0);
  });

  it('is invisible to another organization (RLS)', async () => {
    await clear();
    await withTenant(t.tenant.id, (tx) => recordEvents(tx, page('mine')), { prisma: app });
    const other = await seedTenant('outboxother', 0);
    expect(await withTenant(other.tenant.id, (tx) => tx.eventOutbox.count(), { prisma: app })).toBe(0);
    expect(await withTenant(t.tenant.id, (tx) => tx.eventOutbox.count(), { prisma: app })).toBe(1);
  });

  it('two dispatchers running at once deliver each event exactly once', async () => {
    await clear();
    await owner.notification.deleteMany({ where: { tenantId: t.tenant.id } });
    const n = 30;
    await withTenant(t.tenant.id, (tx) => recordEvents(tx, Array.from({ length: n }, (_, i) => page(`m${i}`))), { prisma: app });
    const [a, b] = await Promise.all([dispatchTenant(t.tenant.id, { prisma: app }), dispatchTenant(t.tenant.id, { prisma: app2 })]);
    expect(a.delivered + b.delivered).toBe(n);
    // Both took part: SKIP LOCKED let them share the work instead of queueing.
    expect(a.delivered).toBeGreaterThan(0);
    expect(b.delivered).toBeGreaterThan(0);
    const rows = await events();
    expect(rows.every((r) => r.status === 'DELIVERED' && r.attempts === 1 && r.deliveredAt)).toBe(true);
    // Contents are dropped once delivered.
    expect(rows.every((r) => JSON.stringify(r.payload) === '{}')).toBe(true);
    // One notification per event, for the one head guard.
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id, type: 'front_desk_page' } })).toBe(n);
    // Nothing left: running again delivers nothing.
    expect((await dispatchAll({ prisma: app })).delivered).toBe(0);
  });

  it('delivering the same event twice notifies once (dedupe key)', async () => {
    await owner.notification.deleteMany({ where: { tenantId: t.tenant.id } });
    const id = '00000000-0000-4000-8000-000000000001';
    for (let i = 0; i < 2; i++) await withTenant(t.tenant.id, (tx) => handleDomainEvent(tx, page('twice'), id), { prisma: app });
    const notes = await owner.notification.findMany({ where: { tenantId: t.tenant.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.dedupeKey).toMatch(new RegExp(`^${id}:`));
  });

  it('a failed delivery is rolled back, retried with backoff, then delivered', async () => {
    await clear();
    await owner.notification.deleteMany({ where: { tenantId: t.tenant.id } });
    await withTenant(t.tenant.id, (tx) => recordEvents(tx, page('flaky')), { prisma: app });
    let calls = 0;
    const flaky = async (tx: Parameters<typeof handleDomainEvent>[0], e: Parameters<typeof handleDomainEvent>[1], id: string) => {
      await handleDomainEvent(tx, e, id);
      if (++calls === 1) throw new Error('provider down');
    };
    const first = await dispatchTenant(t.tenant.id, { prisma: app, handler: flaky });
    expect(first).toEqual({ delivered: 0, retried: 1, dead: 0 });
    let [e] = await events();
    expect(e).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'provider down' });
    expect(e!.availableAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 2000);
    // The handler's notification went with the rollback.
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id } })).toBe(0);
    // Not due yet: nothing happens.
    expect((await dispatchTenant(t.tenant.id, { prisma: app, handler: flaky })).retried).toBe(0);
    await owner.eventOutbox.update({ where: { id: e!.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    expect(await dispatchTenant(t.tenant.id, { prisma: app, handler: flaky })).toEqual({ delivered: 1, retried: 0, dead: 0 });
    [e] = await events();
    expect(e).toMatchObject({ status: 'DELIVERED', attempts: 2, lastError: null });
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id } })).toBe(1);
  });

  it('sets an event aside as dead after the last attempt', async () => {
    await clear();
    await withTenant(t.tenant.id, (tx) => recordEvents(tx, page('doomed')), { prisma: app });
    // A database error inside the handler: the savepoint keeps the claim's transaction usable.
    const broken = async (tx: Parameters<typeof handleDomainEvent>[0]) => {
      await tx.$executeRawUnsafe('SELECT 1/0');
    };
    for (let i = 0; i < 3; i++) {
      await dispatchTenant(t.tenant.id, { prisma: app, handler: broken, maxAttempts: 3 });
      await owner.eventOutbox.updateMany({ where: { tenantId: t.tenant.id, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    }
    const [e] = await events();
    expect(e).toMatchObject({ status: 'DEAD', attempts: 3 });
    expect(e!.lastError).toMatch(/division by zero/);
    // Dead events are reported to /readyz and /metrics, and never picked up again.
    const backlog = await app.$queryRaw<Array<{ channel: string; failed: bigint }>>`SELECT * FROM outbox_backlog()`;
    expect(Number(backlog.find((b) => b.channel === 'events')!.failed)).toBeGreaterThanOrEqual(1);
    expect((await dispatchAll({ prisma: app, handler: broken })).dead).toBe(0);
  });

  it('only organizations with events due are listed to the worker, ids only', async () => {
    await clear();
    await withTenant(t.tenant.id, (tx) => recordEvents(tx, page('due')), { prisma: app });
    const ids = (await app.$queryRaw<Array<{ id: string }>>`SELECT tenants_with_due_events() AS id`).map((r) => r.id);
    expect(ids).toContain(t.tenant.id);
    await dispatchAll({ prisma: app });
    expect((await app.$queryRaw<Array<{ id: string }>>`SELECT tenants_with_due_events() AS id`).map((r) => r.id)).not.toContain(t.tenant.id);
  });
});

describe('safety-critical alerts survive a crash', () => {
  it('an urgent open shift’s text is queued from the outbox even if the API stops right after the commit', async () => {
    await clear();
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { textAlerts: true } } });
    const guard = t.users[0]!;
    await owner.user.update({ where: { id: guard.id }, data: { smsPhone: '+12505550177', smsVerifiedAt: new Date(), smsUrgentShifts: true } });
    const startsAt = new Date(Date.now() + 3 * 3_600_000);
    const shift = await owner.shift.create({
      data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt, endsAt: new Date(startsAt.getTime() + 4 * 3_600_000), status: 'PUBLISHED' },
    });
    const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'Up', email: 'sup@outbox.test' } });
    // The change and its event commit; the process "stops" before delivering (no dispatch here).
    const out = await withTenant(t.tenant.id, (tx) => withEvents(tx, postOffer(tx, { userId: sup.id, tenantId: t.tenant.id, canPostOpenShifts: true }, shift.id)), { prisma: app });
    expect(out.events[0]).toMatchObject({ type: 'shift.offer.posted' });
    expect(await owner.smsOutbox.count({ where: { tenantId: t.tenant.id, template: 'shift_urgent' } })).toBe(0);
    // The worker picks it up.
    expect((await dispatchAll({ prisma: app })).delivered).toBeGreaterThanOrEqual(1);
    const texts = await owner.smsOutbox.findMany({ where: { tenantId: t.tenant.id, template: 'shift_urgent' } });
    expect(texts.map((x) => x.userId)).toContain(guard.id);
    // Delivered again (as if the DELIVERED mark had been lost): no second text.
    const [e] = await events({ type: 'shift.offer.posted' });
    await withTenant(t.tenant.id, (tx) => handleDomainEvent(tx, out.events[0]!, e!.id), { prisma: app });
    expect(await owner.smsOutbox.count({ where: { tenantId: t.tenant.id, template: 'shift_urgent' } })).toBe(texts.length);
  });

  it('a working-alone call for help is stored with its texts and calls in the same transaction', async () => {
    const worker = t.users[0]!;
    const monitor = await owner.user.create({
      data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Mo', lastName: 'Nitor', email: 'monitor@outbox.test', smsPhone: '+12505550178', smsVerifiedAt: new Date() },
    });
    const s = await owner.loneWorkSession.create({
      data: { tenantId: t.tenant.id, userId: worker.id, location: 'Pump house', intervalMinutes: 30, nextDueAt: new Date(Date.now() + 30 * 60_000) },
    });
    const count = () => owner.smsOutbox.count({ where: { tenantId: t.tenant.id, template: 'lonework_help', userId: monitor.id } });
    // Rolled back: no alert at all.
    await expect(
      withTenant(
        t.tenant.id,
        async (tx) => {
          await raiseHelp(tx, s, null);
          throw new Error('crash before commit');
        },
        { prisma: app },
      ),
    ).rejects.toThrow('crash before commit');
    expect(await count()).toBe(0);
    // Committed: the help status, the notification and the call + text are all there together.
    await withTenant(t.tenant.id, (tx) => raiseHelp(tx, s, null), { prisma: app });
    expect(await count()).toBe(2);
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id, type: 'lonework_help', userId: monitor.id } })).toBe(1);
  });
});
