import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/db.js';
import { anonymizeDue, certificationReminders, forgottenClockOuts, recomputeReliability } from '../../src/services/jobs/daily.js';
import { ConsoleMailer, deliverOutbox } from '../../src/services/notifications/mailer.js';
import { app, owner, seedTenant } from './fixtures.js';

let t: Awaited<ReturnType<typeof seedTenant>>;
const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(t.tenant.id, fn, { prisma: app });
const inDays = (n: number) => new Date(`${new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);

beforeAll(async () => {
  t = await seedTenant('rho', 3);
  await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'R', email: 'sup@rho.test' } });
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('background jobs', () => {
  it('sends certification reminders once, and tells supervisors at 30 days', async () => {
    await owner.userCertification.updateMany({ where: { userId: t.users[0]!.id }, data: { expiryDate: inDays(30) } });
    expect(await run((tx) => certificationReminders(tx))).toBe(1);
    expect(await run((tx) => certificationReminders(tx))).toBe(0);
    expect(await owner.notification.count({ where: { userId: t.users[0]!.id, type: 'cert_expiring' } })).toBe(1);
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id, type: 'staff_cert_expiring' } })).toBe(1);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'cert_expiring' } })).toBe(1);
  });

  it('delivers queued email under row-level security, tenant by tenant', async () => {
    const mailer = new ConsoleMailer(true);
    const r = await deliverOutbox(app, mailer);
    expect(r.failed).toBe(0);
    expect(mailer.sent.some((m) => m.subject.includes('expires in 30 days'))).toBe(true);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, sentAt: null } })).toBe(0);
  });

  it('nudges forgotten clock-outs once', async () => {
    await owner.timePunch.create({
      data: { tenantId: t.tenant.id, userId: t.users[1]!.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: new Date(Date.now() - 15 * 3_600_000) },
    });
    expect(await run((tx) => forgottenClockOuts(tx))).toBe(1);
    expect(await run((tx) => forgottenClockOuts(tx))).toBe(0);
  });

  it('stores reliability scores', async () => {
    await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: t.users[2]!.id, type: 'NO_SHOW', occurredAt: new Date(Date.now() - 86_400_000) } });
    expect(await run((tx) => recomputeReliability(tx))).toBe(1);
    expect((await owner.user.findUniqueOrThrow({ where: { id: t.users[2]!.id } })).reliabilityScore).toBe(85);
  });

  it('anonymizes people once their retention period has ended', async () => {
    await owner.user.update({ where: { id: t.users[2]!.id }, data: { status: 'TERMINATED', erasureDueAt: inDays(-1) } });
    expect(await run((tx) => anonymizeDue(tx))).toBe(1);
    const u = await owner.user.findUniqueOrThrow({ where: { id: t.users[2]!.id } });
    expect(u.firstName).toBe('Former');
    expect(await run((tx) => anonymizeDue(tx))).toBe(0);
  });
});
