/**
 * A password alone doesn't become a second factor (SEC-02), and a changed password or a removed
 * passkey ends everyone else's sessions (SEC-31); a re-enabled or reset console admin starts with no
 * sessions (SEC-34).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/auth/passkeys.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/auth/passkeys.js')>();
  return {
    ...real,
    verifyRegistration: async (_rp: unknown, _id: string, _purpose: string, response: { id: string; who: { userId?: string } }) => ({ challenge: response.who, credentialId: response.id, publicKey: Buffer.from('test-key'), counter: 0, transports: [] }),
  };
});

const { createApp } = await import('../../src/app.js');
const { resetLimits } = await import('../../src/auth/rateLimit.js');
const { hashPassword, signAccessToken } = await import('../../src/auth/tokens.js');
const { setPlatformAdmin } = await import('../../src/auth/platform.js');
const { app: appDb, owner, seedTenant } = await import('./fixtures.js');

const server = createApp();
const SUB = 'sessions';
const PASSWORD = 'correct horse battery staple';
const EMAIL = `hr@${SUB}.test`;
let t: Awaited<ReturnType<typeof seedTenant>>;
let hrId = '';
const as = (token: string, cookie?: string) => {
  const w = <T extends request.Test>(r: T) => (cookie ? r.set('Cookie', cookie) : r).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' });
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b), delete: (p: string) => w(request(server).delete(p)) };
};
const signIn = async () => {
  const r = await request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email: EMAIL, password: PASSWORD });
  expect(r.status).toBe(200);
  return { token: r.body.accessToken as string, cookie: String(r.headers['set-cookie']).split(';')[0]! };
};
const enrol = (token: string, cookie: string) => as(token, cookie).post('/api/auth/passkeys', { challengeId: randomUUID(), response: { id: `cred-${randomBytes(4).toString('hex')}`, who: { userId: hrId } } });

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { mfaRoles: ['HR_ADMIN'], mfaCodes: true } });
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Robin', lastName: 'Ash', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })).id;
});
beforeEach(() => resetLimits());
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('a password alone can’t add a first passkey where codes are accepted (SEC-02)', () => {
  it('refuses the passkey until a code confirms the session; then adds it and tells the person', async () => {
    const { token, cookie } = await signIn();
    const refused = await enrol(token, cookie);
    expect([refused.status, refused.body.code]).toEqual([403, 'MFA_CODE_FIRST']);
    expect(await owner.passkey.count({ where: { userId: hrId } })).toBe(0);
    expect((await as(token).post('/api/me/passkeys/options')).body.code).toBe('MFA_CODE_FIRST');
    // A code confirms the session; now a passkey can be added, and the person is told by email.
    expect((await as(token).post('/api/auth/mfa/code', { channel: 'email' })).status).toBe(202);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { tenantId: t.tenant.id, template: 'mfa_code' }, orderBy: { createdAt: 'desc' } });
    const ok = await as(token, cookie).post('/api/auth/mfa/code/verify', { code: (mail.params as { code: string }).code });
    expect(ok.status).toBe(200);
    const added = await enrol(ok.body.accessToken, cookie);
    expect(added.status).toBe(201);
    expect(await owner.emailOutbox.count({ where: { toEmail: EMAIL, template: 'passkey_added' } })).toBe(1);
  });
});

describe('a changed password or a removed passkey ends every other session (SEC-31)', () => {
  const live = () => owner.refreshToken.count({ where: { userId: hrId, revokedAt: null } });

  it('changing the password keeps this session and ends the others, and emails the person', async () => {
    await owner.refreshToken.updateMany({ where: { userId: hrId }, data: { revokedAt: new Date() } });
    const at = new Date(Math.floor(Date.now() / 1000) * 1000);
    const mine = randomUUID();
    await owner.refreshToken.create({ data: { tenantId: t.tenant.id, userId: hrId, familyId: mine, tokenHash: `mine-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), authenticatedAt: at, mfaAt: at } });
    await owner.refreshToken.create({ data: { tenantId: t.tenant.id, userId: hrId, familyId: randomUUID(), tokenHash: `stolen-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), authenticatedAt: new Date(at.getTime() - 3_600_000), mfaAt: at } });
    expect(await live()).toBe(2);
    const token = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: at.getTime() / 1000, mfa: true });
    const r = await as(token).post('/api/me/password', { currentPassword: PASSWORD, newPassword: 'a brand new passphrase 77' });
    expect(r.status).toBe(200);
    const left = await owner.refreshToken.findMany({ where: { userId: hrId, revokedAt: null } });
    expect(left.map((x) => x.familyId)).toEqual([mine]);
    expect(await owner.emailOutbox.count({ where: { toEmail: EMAIL, template: 'password_changed_alert' } })).toBe(1);
  });

  it('removing a passkey ends the other sessions and emails the person', async () => {
    const at = new Date(Math.floor(Date.now() / 1000) * 1000);
    await owner.refreshToken.create({ data: { tenantId: t.tenant.id, userId: hrId, familyId: randomUUID(), tokenHash: `other-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), authenticatedAt: new Date(at.getTime() - 7_200_000), mfaAt: at } });
    const pk = await owner.passkey.create({ data: { tenantId: t.tenant.id, userId: hrId, credentialId: `rogue-${randomBytes(4).toString('hex')}`, publicKey: Buffer.from('x'), name: 'Rogue key' } });
    const token = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: at.getTime() / 1000, mfa: true });
    const before = await owner.refreshToken.count({ where: { userId: hrId, revokedAt: null, authenticatedAt: { lt: new Date(at.getTime() - 1000) } } });
    expect(before).toBeGreaterThan(0);
    expect((await as(token).delete(`/api/me/passkeys/${pk.id}`)).status).toBe(204);
    expect(await owner.refreshToken.count({ where: { userId: hrId, revokedAt: null, authenticatedAt: { lt: new Date(at.getTime() - 1000) } } })).toBe(0);
    expect(await owner.emailOutbox.count({ where: { toEmail: EMAIL, template: 'passkey_removed' } })).toBe(1);
  });
});

describe('re-enabling or resetting a console admin ends their old sessions (SEC-34)', () => {
  it('a session taken before the account was disabled doesn’t come back with it', async () => {
    const email = `fh-${randomBytes(3).toString('hex')}@fh.test`;
    const admin = await owner.platformAdmin.create({ data: { email, name: 'FH', passwordHash: 'x', disabledAt: new Date() } });
    await owner.platformSession.create({ data: { adminId: admin.id, tokenHash: `stolen-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000), mfaAt: new Date() } });
    const r = await setPlatformAdmin(owner, { email, name: 'FH', passwordHash: await hashPassword('a new console password') });
    expect(r.sessionsEnded).toBe(1);
    expect(r.admin.disabledAt).toBeNull();
    expect(await owner.platformSession.count({ where: { adminId: admin.id, revokedAt: null } })).toBe(0);
  });
});
