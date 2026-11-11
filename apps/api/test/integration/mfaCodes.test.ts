import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { ConsoleMailer, deliverEmailTenant } from '../../src/services/notifications/mailer.js';
import { ConsoleSms, deliverSmsTenant } from '../../src/services/notifications/sms.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { RETENTION_DEFAULTS } from '../../src/services/privacy/retention.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'mfacode';
const OTHER = 'mfacode2';
const PASSWORD = 'correct horse battery staple';
let t: Awaited<ReturnType<typeof seedTenant>>;
let t2: Awaited<ReturnType<typeof seedTenant>>;
let hrId: string;
let otherHrId: string;

const signIn = async (sub = SUB, email = 'hr@mfacode.test') => {
  const r = await request(server).post('/api/auth/login').set('x-tenant-subdomain', sub).send({ email, password: PASSWORD });
  expect(r.status).toBe(200);
  return { token: r.body.accessToken as string, cookie: String(r.headers['set-cookie']).split(';')[0]! };
};
const as = (token: string, cookie = '', sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).set('Cookie', cookie).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).set('Cookie', cookie).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).set('Cookie', cookie).auth(token, { type: 'bearer' }).send(b),
});
const lastEmailCode = async () => {
  const m = await owner.emailOutbox.findFirstOrThrow({ where: { tenantId: t.tenant.id, template: 'mfa_code' }, orderBy: { createdAt: 'desc' } });
  return (m.params as { code: string }).code;
};
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
const hrToken = (mfa: boolean) => signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa });

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  t2 = await seedTenant(OTHER, 0);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { mfaRoles: ['HR_ADMIN'], features: { textAlerts: true } } });
  await owner.tenant.update({ where: { id: t2.tenant.id }, data: { mfaRoles: ['HR_ADMIN'] } });
  forgetFeatures(t.tenant.id);
  forgetFeatures(t2.tenant.id);
  const passwordHash = await hashPassword(PASSWORD);
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Jordan', lastName: 'Reid', email: 'hr@mfacode.test', passwordHash } })).id;
  otherHrId = (await owner.user.create({ data: { tenantId: t2.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Other', lastName: 'City', email: 'hr@mfacode2.test', passwordHash } })).id;
});
beforeEach(async () => {
  resetLimits();
  await owner.user.update({ where: { id: hrId }, data: { smsPhone: null, smsVerifiedAt: null } });
});
afterAll(async () => {
  await owner.rateLimitHit.deleteMany({ where: { key: { startsWith: 'mfa-' } } });
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('a sign-in code by email or text as the second factor', () => {
  it('offers email always, a text only to a confirmed number, with masked destinations', async () => {
    const { token } = await signIn();
    const o = await as(token).get('/api/auth/mfa/options');
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ codes: true, channels: [{ channel: 'email', destination: 'h•••@mfacode.test' }], expiresInMinutes: 10, resendAfterSeconds: 30 });

    // An unconfirmed number isn't offered, nor used.
    await owner.user.update({ where: { id: hrId }, data: { smsPhone: '+12505554267' } });
    expect((await as(token).get('/api/auth/mfa/options')).body.channels).toHaveLength(1);
    const refused = await as(token).post('/api/auth/mfa/code', { channel: 'sms' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NO_VERIFIED_PHONE');
    expect(await owner.smsOutbox.count({ where: { userId: hrId, template: 'mfa_code' } })).toBe(0);

    await owner.user.update({ where: { id: hrId }, data: { smsVerifiedAt: new Date() } });
    expect((await as(token).get('/api/auth/mfa/options')).body.channels).toEqual([
      { channel: 'email', destination: 'h•••@mfacode.test' },
      { channel: 'sms', destination: '•••-•••-4267' },
    ]);
  });

  it('emails a code through the outbox; only a keyed hash is kept, and the email’s copy goes once it’s sent', async () => {
    const { token } = await signIn();
    const r = await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ channel: 'email', destination: 'h•••@mfacode.test', expiresInMinutes: 10 });

    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { tenantId: t.tenant.id, template: 'mfa_code', sentAt: null } });
    expect(mail.toEmail).toBe('hr@mfacode.test');
    const params = mail.params as Record<string, string>;
    expect(Object.keys(params).sort()).toEqual(['code', 'name', 'organization']);
    expect(params.code).toMatch(/^\d{6}$/);

    const row = await owner.mfaCode.findFirstOrThrow({ where: { userId: hrId }, orderBy: { createdAt: 'desc' } });
    expect(row.channel).toBe('EMAIL');
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toBe(createHash('sha256').update(params.code!).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(`"${params.code}"`);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(9.9 * 60_000);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(10 * 60_000 + 1000);

    const mailer = new ConsoleMailer(true);
    await deliverEmailTenant(t.tenant.id, mailer);
    const sent = mailer.sent.find((m) => m.to === 'hr@mfacode.test')!;
    expect(sent.subject).toBe('Your FlexcityHeadquarters sign-in code');
    expect(sent.text).toContain(params.code);
    expect(sent.text).toContain('Jordan Reid');
    expect(sent.text).toContain(`City of ${SUB}`);
    expect(sent.text).toMatch(/10 minutes/);
    expect(sent.text).toMatch(/change it now/);
    // Sent: the code leaves the database; the log row (who, which template) is kept 90 days.
    const after = await owner.emailOutbox.findUniqueOrThrow({ where: { id: mail.id } });
    expect(after.sentAt).not.toBeNull();
    expect(after.params).toEqual({});
    expect(RETENTION_DEFAULTS.emailLogDays).toBe(90);
  });

  it('a right code works once, clears MFA_REQUIRED for the session, and survives a token refresh', async () => {
    const { token, cookie } = await signIn();
    expect((await as(token).get('/api/users')).body.code).toBe('MFA_REQUIRED');
    await as(token, cookie).post('/api/auth/mfa/code', { channel: 'email' });
    const code = await lastEmailCode();

    const ok = await as(token, cookie).post('/api/auth/mfa/code/verify', { code });
    expect(ok.status).toBe(200);
    expect((await as(ok.body.accessToken).get('/api/users')).status).toBe(200);
    expect((await as(ok.body.accessToken).get('/api/me')).body.mfaRequired).toBe(false);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'mfa.code', actorId: hrId } })).toBeGreaterThan(0);

    // The refresh token now carries the second factor.
    const refreshed = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect((await as(refreshed.body.accessToken).get('/api/users')).status).toBe(200);

    // The same code can't be used again (from another password-only session).
    const other = await signIn();
    const again = await as(other.token, other.cookie).post('/api/auth/mfa/code/verify', { code });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('MFA_CODE_EXPIRED');
    // A session that already has its second factor has nothing to do here.
    expect((await as(ok.body.accessToken).post('/api/auth/mfa/code', { channel: 'email' })).body.code).toBe('MFA_NOT_NEEDED');
  });

  it('five wrong tries end the code, even for the right one afterwards', async () => {
    const { token } = await signIn();
    await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    const code = await lastEmailCode();
    for (let left = 4; left >= 1; left--) {
      const r = await as(token).post('/api/auth/mfa/code/verify', { code: wrong(code) });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'MFA_CODE_WRONG', details: { attemptsLeft: left } });
    }
    expect((await as(token).post('/api/auth/mfa/code/verify', { code: wrong(code) })).body.code).toBe('MFA_CODE_LOCKED');
    expect((await as(token).post('/api/auth/mfa/code/verify', { code })).body.code).toBe('MFA_CODE_LOCKED');
    expect((await owner.mfaCode.findFirstOrThrow({ where: { userId: hrId }, orderBy: { createdAt: 'desc' } })).attempts).toBe(5);
  });

  it('refuses an expired code, and a newer code supersedes an older one', async () => {
    const { token } = await signIn();
    await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    const first = await lastEmailCode();
    await owner.mfaCode.updateMany({ where: { userId: hrId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await as(token).post('/api/auth/mfa/code/verify', { code: first })).body.code).toBe('MFA_CODE_EXPIRED');

    await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    const second = await lastEmailCode();
    await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    const third = await lastEmailCode();
    // Only the newest one is still waiting to be emailed.
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'mfa_code', sentAt: null } })).toBe(1);
    if (second !== third) expect((await as(token).post('/api/auth/mfa/code/verify', { code: second })).body.code).toBe('MFA_CODE_WRONG');
    expect((await as(token).post('/api/auth/mfa/code/verify', { code: third })).status).toBe(200);
  });

  it('texts a code to the confirmed number through the urgent text path', async () => {
    await owner.user.update({ where: { id: hrId }, data: { smsPhone: '+12505554267', smsVerifiedAt: new Date() } });
    const { token } = await signIn();
    const r = await as(token).post('/api/auth/mfa/code', { channel: 'sms' });
    expect(r.status).toBe(202);
    expect(r.body.destination).toBe('•••-•••-4267');
    const queued = await owner.smsOutbox.findFirstOrThrow({ where: { userId: hrId, template: 'mfa_code', sentAt: null } });
    const code = (queued.params as { code: string }).code;
    expect(Object.keys(queued.params as object).sort()).toEqual(['code', 'organization']);
    expect((await owner.mfaCode.findFirstOrThrow({ where: { userId: hrId }, orderBy: { createdAt: 'desc' } })).channel).toBe('SMS');

    const sms = new ConsoleSms(true);
    await deliverSmsTenant(t.tenant.id, sms);
    expect(sms.sent.find((m) => m.to === '+12505554267')!.body).toMatch(new RegExp(`^FlexcityHeadquarters: ${code} is your sign-in code`));
    expect((await owner.smsOutbox.findUniqueOrThrow({ where: { id: queued.id } })).params).toEqual({});
    expect((await as(token).post('/api/auth/mfa/code/verify', { code })).status).toBe(200);
  });

  it('an organization can allow passkeys only', async () => {
    const hr = await hrToken(true);
    expect((await as(hr).get('/api/settings/mfa')).body.codes).toBe(true);
    const off = await as(hr).put('/api/settings/mfa', { roles: [], codes: false });
    expect(off.status).toBe(200);
    expect(off.body.codes).toBe(false);
    try {
      const { token } = await signIn();
      expect((await as(token).get('/api/auth/mfa/options')).body).toEqual({ codes: false, channels: [] });
      const send = await as(token).post('/api/auth/mfa/code', { channel: 'email' });
      expect(send.status).toBe(403);
      expect(send.body.code).toBe('MFA_CODES_OFF');
      expect((await as(token).post('/api/auth/mfa/code/verify', { code: '123456' })).body.code).toBe('MFA_CODES_OFF');
      // Changing only who needs a second factor leaves the switch as it is.
      expect((await as(hr).put('/api/settings/mfa', { roles: [] })).body.codes).toBe(false);
    } finally {
      expect((await as(hr).put('/api/settings/mfa', { roles: [], codes: true })).body.codes).toBe(true);
    }
  });

  it('only sessions that owe a second factor use codes', async () => {
    const guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
    const r = await as(guard).post('/api/auth/mfa/code', { channel: 'email' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MFA_NOT_NEEDED');
  });

  it('limits sends to 3 per 15 minutes and verifies to 10 per 15 minutes per person', async () => {
    const { token } = await signIn();
    for (let i = 0; i < 3; i++) expect((await as(token).post('/api/auth/mfa/code', { channel: 'email' })).status).toBe(202);
    const fourth = await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('TOO_MANY_CODES');

    for (let i = 0; i < 10; i++) expect((await as(token).post('/api/auth/mfa/code/verify', { code: '000000' })).status).toBe(400);
    const eleventh = await as(token).post('/api/auth/mfa/code/verify', { code: '000000' });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe('TOO_MANY_TRIES');
  });

  it('limits sends to 10 a day per person and verifies to 30 per 15 minutes per address (shared store)', async () => {
    const before = process.env.RATE_LIMIT_STORE;
    process.env.RATE_LIMIT_STORE = 'database';
    try {
      await owner.rateLimitHit.deleteMany({ where: { key: { startsWith: 'mfa-' } } });
      const { token } = await signIn();
      // Ten sends earlier today (outside the 15-minute window): the eleventh is refused.
      const earlier = new Date(Date.now() - 2 * 3_600_000);
      await owner.rateLimitHit.createMany({ data: Array.from({ length: 10 }, () => ({ key: `mfa-send-day:${hrId}`, at: earlier })) });
      const r = await as(token).post('/api/auth/mfa/code', { channel: 'email' });
      expect(r.status).toBe(429);
      expect(r.body.code).toBe('TOO_MANY_CODES');

      // One try from this address, then 29 more from other people at the same address.
      expect((await as(token).post('/api/auth/mfa/code/verify', { code: '000000' })).status).toBe(400);
      const ipKey = (await owner.rateLimitHit.findFirstOrThrow({ where: { key: { startsWith: 'mfa-verify-ip:' } } })).key;
      await owner.rateLimitHit.createMany({ data: Array.from({ length: 29 }, () => ({ key: ipKey, at: new Date() })) });
      const blocked = await as(token).post('/api/auth/mfa/code/verify', { code: '000000' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('TOO_MANY_TRIES');
    } finally {
      if (before === undefined) delete process.env.RATE_LIMIT_STORE;
      else process.env.RATE_LIMIT_STORE = before;
      await owner.rateLimitHit.deleteMany({ where: { key: { startsWith: 'mfa-' } } });
    }
  });

  it('another organization’s user can’t verify this organization’s code', async () => {
    const { token } = await signIn();
    await as(token).post('/api/auth/mfa/code', { channel: 'email' });
    const code = await lastEmailCode();

    // Their token doesn't open this organization at all.
    const other = await signIn(OTHER, 'hr@mfacode2.test');
    expect((await as(other.token, other.cookie, SUB).post('/api/auth/mfa/code/verify', { code })).status).toBe(403);
    // In their own organization, the code means nothing: there's no code for them.
    const own = await as(other.token, other.cookie, OTHER).post('/api/auth/mfa/code/verify', { code });
    expect(own.status).toBe(400);
    expect(own.body.code).toBe('MFA_CODE_EXPIRED');
    // A forged token for our organization naming their user finds no code either.
    const forged = await signAccessToken({ sub: otherHrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
    expect((await as(forged).post('/api/auth/mfa/code/verify', { code })).status).not.toBe(200);
    // The code is still unused, and still works for its owner.
    expect((await owner.mfaCode.findFirstOrThrow({ where: { userId: hrId }, orderBy: { createdAt: 'desc' } })).usedAt).toBeNull();
    expect((await as(token).post('/api/auth/mfa/code/verify', { code })).status).toBe(200);
  });
});
