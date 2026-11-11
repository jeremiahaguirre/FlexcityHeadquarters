import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { applyRetention } from '../../src/services/privacy/retention.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'keepcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
const days = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: `hr@${SUB}.test` } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa: true });
  const u = t.users[0]!.id;
  const tenantId = t.tenant.id;
  await owner.notification.createMany({ data: [{ tenantId, userId: u, type: 'old', createdAt: days(800) }, { tenantId, userId: u, type: 'recent', createdAt: days(10) }] });
  await owner.emailOutbox.createMany({
    data: [
      { tenantId, toEmail: 'a@x.test', template: 'invite', sentAt: days(100), createdAt: days(100) },
      { tenantId, toEmail: 'b@x.test', template: 'invite', createdAt: days(100) }, // still waiting: kept
      { tenantId, toEmail: 'c@x.test', template: 'invite', sentAt: days(5), createdAt: days(5) },
    ],
  });
  await owner.refreshToken.createMany({
    data: [
      { tenantId, userId: u, familyId: crypto.randomUUID(), tokenHash: 'old-revoked', expiresAt: days(-10), revokedAt: days(40), authenticatedAt: days(50) },
      { tenantId, userId: u, familyId: crypto.randomUUID(), tokenHash: 'live', expiresAt: days(-10), authenticatedAt: days(1) },
    ],
  });
  await owner.mfaCode.createMany({
    data: [
      { id: crypto.randomUUID(), tenantId, userId: u, channel: 'EMAIL', codeHash: 'old', expiresAt: days(31) },
      { id: crypto.randomUUID(), tenantId, userId: u, channel: 'SMS', codeHash: 'recent', expiresAt: days(2) },
    ],
  });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('retention', () => {
  it('removes old notifications, finished emails, ended sessions and old sign-in codes, nothing current', async () => {
    const removed = await withTenant(t.tenant.id, (tx) => applyRetention(tx));
    expect(removed).toBe(4);
    expect((await owner.notification.findMany({ where: { tenantId: t.tenant.id } })).map((n) => n.type)).toEqual(['recent']);
    expect((await owner.emailOutbox.findMany({ where: { tenantId: t.tenant.id } })).map((e) => e.toEmail).sort()).toEqual(['b@x.test', 'c@x.test']);
    expect((await owner.refreshToken.findMany({ where: { tenantId: t.tenant.id } })).map((r) => r.tokenHash)).toEqual(['live']);
    expect((await owner.mfaCode.findMany({ where: { tenantId: t.tenant.id } })).map((c) => c.codeHash)).toEqual(['recent']);
  });

  it('each organization sets its own periods, within limits', async () => {
    const call = (b?: object) => (b ? request(server).put('/api/settings/retention').send(b) : request(server).get('/api/settings/retention')).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' });
    expect((await call()).body).toMatchObject({ notificationsDays: 730, emailLogDays: 90 });
    expect((await call({ notificationsDays: 10, emailLogDays: 90 })).status).toBe(400);
    expect((await call({ notificationsDays: 365, emailLogDays: 30 })).status).toBe(200);
    await owner.notification.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, type: 'year-and-a-half', createdAt: days(500) } });
    expect(await withTenant(t.tenant.id, (tx) => applyRetention(tx))).toBe(1);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'settings.retention' } })).toBe(1);
  });
});
