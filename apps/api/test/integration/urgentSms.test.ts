/**
 * Urgent texts and calls go out straight after the commit that queued them (in-process), are
 * claimed so racing deliveries send each one once, retry soon after a failure, and raise an alert
 * when a safety message is stuck. Other cities' messages are never touched.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { readiness } from '../../src/lib/health.js';
import { errorsTotal, safetySmsOverdueAlerts, smsQueueToSent, smsSends } from '../../src/lib/metrics.js';
import { ConsoleMailer } from '../../src/services/notifications/mailer.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { notify } from '../../src/services/notifications/notifier.js';
import { ConsoleSms, deliverSmsTenant, RETRY_AT_KEY, SAFETY_TEMPLATES, type SmsSender } from '../../src/services/notifications/sms.js';
import { checkOverdueSafety, enableInlineUrgent, tenantsWithDueSms } from '../../src/services/notifications/urgent.js';
import { loneWorkChecks } from '../../src/services/safety/loneWork.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'urgenttexts';
let t: Awaited<ReturnType<typeof seedTenant>>;
let other: Awaited<ReturnType<typeof seedTenant>>;
const id = { worker: '', sup: '', otherSup: '' };
const tok = { worker: '' };
let stop: (() => Promise<void>) | null = null;

const as = (token: string) => ({
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

/** Waits until `check` holds (polling), failing after `ms`. */
async function within(ms: number, check: () => Promise<boolean> | boolean): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await check()) return Date.now() - started;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`not within ${ms} ms`);
}

/** A sender that waits before accepting, so deliveries overlap. */
class SlowSms extends ConsoleSms {
  constructor(private readonly delayMs: number) {
    super(true);
  }
  override async text(to: string, body: string) {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return super.text(to, body);
  }
  override async call(to: string, words: string) {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return super.call(to, words);
  }
}

const queue = (tenantId: string, template: string, userId: string | null = null, extra: object = {}) =>
  owner.smsOutbox.create({ data: { tenantId, userId, toPhone: '+12505550111', template, params: { name: 'Sam', location: 'Pump 4' }, ...extra } });

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  other = await seedTenant('urgentother', 0);
  for (const x of [t, other]) {
    await owner.tenant.update({ where: { id: x.tenant.id }, data: { features: { textAlerts: true, emailNotifications: true } } });
    forgetFeatures(x.tenant.id);
  }
  const mk = (tenantId: string, roles: ('EMPLOYEE' | 'AQUATIC_SUPERVISOR')[], name: string, phone: string | null) =>
    owner.user.create({ data: { tenantId, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'U', email: `${name}@${SUB}.test`, smsPhone: phone, smsVerifiedAt: phone ? new Date() : null } });
  id.worker = (await mk(t.tenant.id, ['EMPLOYEE'], 'lone', null)).id;
  id.sup = (await mk(t.tenant.id, ['AQUATIC_SUPERVISOR'], 'sup', '+12505550121')).id;
  id.otherSup = (await mk(other.tenant.id, ['AQUATIC_SUPERVISOR'], 'osup', '+12505550131')).id;
  tok.worker = await signAccessToken({ sub: id.worker, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: Math.floor(Date.now() / 1000) });
});
afterEach(async () => {
  await stop?.();
  stop = null;
  await owner.smsOutbox.deleteMany({ where: { tenantId: { in: [t.tenant.id, other.tenant.id] } } });
  await owner.loneWorkSession.deleteMany({ where: { tenantId: t.tenant.id } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('urgent texts and calls', () => {
  it('a call for help is called and texted within the same request cycle, not at the next minute', async () => {
    const sender = new ConsoleSms(true);
    const mailer = new ConsoleMailer(true);
    stop = enableInlineUrgent({ sms: sender, mailer });
    const before = smsQueueToSent.count({ priority: 'safety', kind: 'TEXT' });
    expect((await as(tok.worker).post('/api/me/lone-work', { location: 'Pump station 4', intervalMinutes: 30 })).status).toBe(201);
    expect((await as(tok.worker).post('/api/me/lone-work/help', { note: 'Fell' })).status).toBe(200);
    const took = await within(2_000, () => sender.sent.length >= 2);
    expect(took).toBeLessThan(2_000);
    expect(sender.sent.map((m) => m.kind)).toEqual(['CALL', 'TEXT']);
    expect(sender.sent.every((m) => m.to === '+12505550121' && m.body.startsWith('URGENT, FlexcityHeadquarters. lone U asked for help'))).toBe(true);
    await within(1_000, async () => (await owner.smsOutbox.count({ where: { tenantId: t.tenant.id, sentAt: null } })) === 0);
    expect(smsQueueToSent.count({ priority: 'safety', kind: 'TEXT' })).toBe(before + 1);
    // The email that goes with it doesn't wait for the worker's minute either.
    await within(2_000, () => mailer.sent.some((m) => m.to === `sup@${SUB}.test`));
  });

  it('a working-alone escalation from the worker’s job goes out straight after the job commits', async () => {
    const sender = new ConsoleSms(true);
    stop = enableInlineUrgent({ sms: sender });
    const s = await owner.loneWorkSession.create({
      data: { tenantId: t.tenant.id, userId: id.worker, location: 'Reservoir', intervalMinutes: 30, status: 'OVERDUE', lastCheckInAt: new Date(Date.now() - 60 * 60_000), nextDueAt: new Date(Date.now() - 30 * 60_000), overdueAt: new Date(Date.now() - 20 * 60_000) },
    });
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    expect((await owner.loneWorkSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ESCALATED');
    await within(2_000, () => sender.sent.filter((m) => m.body.includes('has not checked in while working alone at Reservoir')).length === 2);
    const rows = await owner.smsOutbox.findMany({ where: { tenantId: t.tenant.id, template: 'lonework_escalated' } });
    expect(rows.map((r) => r.kind).sort()).toEqual(['CALL', 'TEXT']);
    await within(1_000, async () => (await owner.smsOutbox.count({ where: { tenantId: t.tenant.id, template: 'lonework_escalated', sentAt: null } })) === 0);
  });

  it('nothing is sent when the transaction rolls back', async () => {
    const sender = new ConsoleSms(true);
    stop = enableInlineUrgent({ sms: sender });
    await withTenant(t.tenant.id, async (tx) => {
      await notify(tx, t.tenant.id, [{ userId: id.sup, type: 'lonework_help', params: { name: 'A', location: 'B' }, sms: 'call' }]);
      throw new Error('rolled back');
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(sender.sent).toHaveLength(0);
    expect(await owner.smsOutbox.count({ where: { tenantId: t.tenant.id } })).toBe(0);
  });

  it('the worker and the API delivering at once send each message once', async () => {
    for (let i = 0; i < 6; i++) await queue(t.tenant.id, i % 2 ? 'lonework_help' : 'lonework_overdue', id.sup);
    const api = new SlowSms(30);
    const worker = new SlowSms(30);
    stop = enableInlineUrgent({ sms: api });
    // The inline kick (as after a commit), and two "workers" through different connections.
    const { kickUrgent } = await import('../../src/services/notifications/urgent.js');
    kickUrgent(t.tenant.id);
    const [a, b] = await Promise.all([deliverSmsTenant(t.tenant.id, worker, { prisma: appDb }), deliverSmsTenant(t.tenant.id, worker, { prisma: owner })]);
    await stop();
    stop = null;
    expect(a.sent + b.sent + api.sent.length).toBe(6);
    expect(worker.sent.length + api.sent.length).toBe(6);
    const rows = await owner.smsOutbox.findMany({ where: { tenantId: t.tenant.id } });
    expect(rows.every((r) => r.sentAt && r.attempts === 1)).toBe(true);
  });

  it('safety alerts go out before open-shift texts', async () => {
    await queue(t.tenant.id, 'shift_urgent', id.sup, { params: { position: 'Lifeguard', facility: 'Pool', startsAt: new Date().toISOString(), tz: 'America/Vancouver' } });
    await new Promise((r) => setTimeout(r, 5));
    await queue(t.tenant.id, 'callout_offer', id.sup, { params: { reason: 'Snow', facility: 'Yard', minutes: 10 } });
    const sender = new ConsoleSms(true);
    await deliverSmsTenant(t.tenant.id, sender, { limit: 1 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.body).toMatch(/^FH call-out: Snow/);
  });

  it('a failed safety text is retried after 15 s, not a minute, and is never sent twice', async () => {
    const m = await queue(t.tenant.id, 'lonework_help', id.sup);
    let fail = true;
    const sent: string[] = [];
    const flaky: SmsSender = {
      text: async (_to, body) => {
        if (fail) throw new Error('provider answered 503');
        sent.push(body);
      },
      call: async () => undefined,
    };
    const retries = smsSends.get({ priority: 'safety', outcome: 'retry' });
    const r1 = await deliverSmsTenant(t.tenant.id, flaky);
    expect(r1).toMatchObject({ sent: 0, failed: 1, retryInMs: 15_000 });
    expect(smsSends.get({ priority: 'safety', outcome: 'retry' })).toBe(retries + 1);
    const row = await owner.smsOutbox.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('503');
    const at = new Date((row.params as Record<string, string>)[RETRY_AT_KEY]!).getTime();
    expect(at - Date.now()).toBeGreaterThan(10_000);
    expect(at - Date.now()).toBeLessThanOrEqual(15_000);
    // Not due yet: neither this sweep nor the worker's picks it up.
    fail = false;
    expect((await deliverSmsTenant(t.tenant.id, flaky)).sent).toBe(0);
    expect(await tenantsWithDueSms(appDb)).not.toContain(t.tenant.id);
    // 15 s later (moved back here instead of waiting).
    await owner.smsOutbox.update({ where: { id: m.id }, data: { params: { name: 'Sam', location: 'Pump 4', [RETRY_AT_KEY]: new Date(Date.now() - 1000).toISOString() } } });
    expect(await tenantsWithDueSms(appDb)).toContain(t.tenant.id);
    expect((await deliverSmsTenant(t.tenant.id, flaky)).sent).toBe(1);
    expect((await deliverSmsTenant(t.tenant.id, flaky)).sent).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(RETRY_AT_KEY);
    const done = await owner.smsOutbox.findUniqueOrThrow({ where: { id: m.id } });
    expect(done).toMatchObject({ attempts: 2, lastError: null, params: {} });
    expect(done.sentAt).not.toBeNull();
  });

  it('a safety text still unsent after 2 minutes raises an alert and a readiness warning', async () => {
    await queue(t.tenant.id, 'lonework_escalated', id.sup, { createdAt: new Date(Date.now() - 3 * 60_000), attempts: 3, lastError: 'provider down' });
    await queue(other.tenant.id, 'shift_urgent', id.otherSup, { createdAt: new Date(Date.now() - 3 * 60_000) });
    const alerts = safetySmsOverdueAlerts.get();
    const errors = errorsTotal.get({ source: 'job' });
    const found = await checkOverdueSafety(appDb);
    expect(found).toEqual([{ tenantId: t.tenant.id, overdue: 1, oldestAgeS: expect.any(Number) }]);
    expect(found[0]!.oldestAgeS).toBeGreaterThanOrEqual(180);
    expect(safetySmsOverdueAlerts.get()).toBe(alerts + 1);
    expect(errorsTotal.get({ source: 'job' })).toBe(errors + 1);
    // Once, until more are late (or 15 minutes pass).
    await checkOverdueSafety(appDb);
    expect(safetySmsOverdueAlerts.get()).toBe(alerts + 1);
    const r = await readiness();
    expect(r.checks.outbox).toMatchObject({ status: 'warn', reason: expect.stringContaining('safety texts waiting longer than 120s'), sms_safety: { pending: 1 } });
    expect(r.checks.outbox.oldestSafetyS).toBeGreaterThanOrEqual(180);
    expect(r.ready).toBe(true);
    expect((await readiness({ strict: true })).ready).toBe(false);
  });

  it('the backlog counts every safety template, and only those', async () => {
    for (const tpl of SAFETY_TEMPLATES) await queue(t.tenant.id, tpl, id.sup);
    await queue(t.tenant.id, 'shift_urgent', id.sup);
    await queue(t.tenant.id, 'sms_verify', id.sup);
    const rows = await appDb.$queryRaw<Array<{ channel: string; pending: bigint }>>`SELECT * FROM outbox_backlog()`;
    // Other files' rows are cleaned up by their own tests; this city's are the only unsent safety ones.
    expect(Number(rows.find((x) => x.channel === 'sms_safety')!.pending)).toBe(SAFETY_TEMPLATES.length);
  });

  it('delivering one city never touches another’s messages', async () => {
    const mine = await queue(t.tenant.id, 'lonework_help', id.sup);
    const theirs = await queue(other.tenant.id, 'lonework_help', id.otherSup);
    const sender = new ConsoleSms(true);
    stop = enableInlineUrgent({ sms: sender });
    const { kickUrgent } = await import('../../src/services/notifications/urgent.js');
    kickUrgent(t.tenant.id);
    await within(2_000, () => sender.sent.length === 1);
    expect((await deliverSmsTenant(t.tenant.id, sender, { prisma: appDb })).sent).toBe(0);
    expect(sender.sent.map((m) => m.to)).toEqual(['+12505550111']);
    expect((await owner.smsOutbox.findUniqueOrThrow({ where: { id: mine.id } })).sentAt).not.toBeNull();
    const untouched = await owner.smsOutbox.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched).toMatchObject({ sentAt: null, attempts: 0, lastError: null });
    expect(untouched.params).toEqual({ name: 'Sam', location: 'Pump 4' });
  });
});
