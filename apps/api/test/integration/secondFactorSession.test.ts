/**
 * A completed second factor belongs to the session, not to one page's access token: it survives a
 * reload (a refresh from the cookie alone) and every rotation, never a new password sign-in, and the
 * usual re-authentication rules still apply. The same for Dev console sessions.
 * The WebAuthn checks themselves are covered elsewhere; here they're stubbed.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/auth/passkeys.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/auth/passkeys.js')>();
  return {
    ...real,
    // The response carries who the challenge was for, as the real challenge row would.
    verifyRegistration: async (_rp: unknown, _id: string, _purpose: string, response: { id: string; who: { userId?: string; adminId?: string } }) => ({
      challenge: response.who,
      credentialId: response.id,
      publicKey: Buffer.from('test-key'),
      counter: 0,
      transports: [],
    }),
    verifyAuthentication: async (_rp: unknown, _id: string, _purpose: string, response: { who: { userId?: string; adminId?: string } }, passkey: unknown) => {
      if (!passkey) throw new Error('unknown passkey');
      return { challenge: response.who, newCounter: 1 };
    },
  };
});

const { createApp } = await import('../../src/app.js');
const { resetLimits } = await import('../../src/auth/rateLimit.js');
const { hashPassword, verifyAccessToken } = await import('../../src/auth/tokens.js');
const { forgetFeatures } = await import('../../src/services/platform/features.js');
const { app: appDb, owner, seedTenant } = await import('./fixtures.js');

const server = createApp();
const SUB = 'mfasession';
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'hr@mfasession.test';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hrId: string;

const cookieOf = (r: request.Response) => String(r.headers['set-cookie']).split(';')[0]!;
const signIn = async () => {
  const r = await request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email: EMAIL, password: PASSWORD });
  expect(r.status).toBe(200);
  return { token: r.body.accessToken as string, cookie: cookieOf(r) };
};
/** What a page reload does: no access token in memory, only the refresh cookie. */
const reload = async (cookie: string) => {
  const r = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', cookie);
  expect(r.status).toBe(200);
  return { token: r.body.accessToken as string, cookie: cookieOf(r) };
};
const as = (token: string, cookie = '') => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie).auth(token, { type: 'bearer' }).send(b),
});
const mfaOf = async (token: string) => (await verifyAccessToken(token)).mfa;
const hasSecondFactor = async (token: string) => (await as(token).get('/api/users')).status === 200;
const enrol = (token: string, cookie: string, path = '/api/auth/passkeys') =>
  as(token, cookie).post(path, { challengeId: randomUUID(), response: { id: `cred-${randomBytes(4).toString('hex')}`, who: { userId: hrId } } });

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { mfaRoles: ['HR_ADMIN'] } });
  forgetFeatures(t.tenant.id);
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Robin', lastName: 'Ash', email: EMAIL, passwordHash: await hashPassword(PASSWORD) } })).id;
});
beforeEach(async () => {
  resetLimits();
  await owner.passkey.deleteMany({ where: { userId: hrId } });
});
afterAll(async () => {
  delete process.env.PLATFORM_MFA;
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('organization sessions: the second factor lasts the session', () => {
  it('a first passkey set up as the second factor survives a reload and every rotation', async () => {
    const { token, cookie } = await signIn();
    expect(await mfaOf(token)).toBe(false);
    expect(await hasSecondFactor(token)).toBe(false);
    const added = await enrol(token, cookie);
    expect(added.status).toBe(201);
    expect(await mfaOf(added.body.accessToken)).toBe(true);
    // Reload: the cookie alone gives a token with the second factor…
    const first = await reload(cookie);
    expect(await mfaOf(first.token)).toBe(true);
    expect(await hasSecondFactor(first.token)).toBe(true);
    expect((await as(first.token).get('/api/me')).body.mfaRequired).toBe(false);
    // …and so does every rotation after it.
    const second = await reload(first.cookie);
    const third = await reload(second.cookie);
    expect(await mfaOf(third.token)).toBe(true);
    expect(await hasSecondFactor(third.token)).toBe(true);
  });

  it('a passkey confirmation (the account already has one) survives a reload', async () => {
    const pk = await owner.passkey.create({ data: { tenantId: t.tenant.id, userId: hrId, credentialId: `cred-${randomBytes(4).toString('hex')}`, publicKey: Buffer.from('x'), name: 'Phone' } });
    const { token, cookie } = await signIn();
    const up = await as(token, cookie).post('/api/auth/step-up', { challengeId: randomUUID(), response: { id: pk.credentialId, who: { userId: hrId } } });
    expect(up.status).toBe(200);
    expect(await mfaOf(up.body.accessToken)).toBe(true);
    const after = await reload(cookie);
    expect(await mfaOf(after.token)).toBe(true);
    expect(await mfaOf((await reload(after.cookie)).token)).toBe(true);
  });

  it('a one-time code survives a reload and rotation', async () => {
    const { token, cookie } = await signIn();
    expect((await as(token).post('/api/auth/mfa/code', { channel: 'email' })).status).toBe(202);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { tenantId: t.tenant.id, template: 'mfa_code' }, orderBy: { createdAt: 'desc' } });
    const ok = await as(token, cookie).post('/api/auth/mfa/code/verify', { code: (mail.params as { code: string }).code });
    expect(ok.status).toBe(200);
    const after = await reload(cookie);
    expect(await mfaOf(after.token)).toBe(true);
    expect(await mfaOf((await reload(after.cookie)).token)).toBe(true);
  });

  it('a new password sign-in starts without it, and confirming with the password doesn’t give it', async () => {
    const before = await signIn();
    expect((await enrol(before.token, before.cookie)).status).toBe(201);
    expect(await mfaOf((await reload(before.cookie)).token)).toBe(true);
    const fresh = await signIn();
    expect(await mfaOf(fresh.token)).toBe(false);
    expect(await mfaOf((await reload(fresh.cookie)).token)).toBe(false);
    const fresh2 = await signIn();
    const up = await as(fresh2.token, fresh2.cookie).post('/api/auth/step-up', { password: PASSWORD });
    expect(up.status).toBe(200);
    expect(await mfaOf(up.body.accessToken)).toBe(false);
    expect(await mfaOf((await reload(fresh2.cookie)).token)).toBe(false);
  });

  it('the re-authentication rules still apply: the sign-in time ages, an expired session ends', async () => {
    const { token, cookie } = await signIn();
    expect((await enrol(token, cookie)).status).toBe(201);
    // Half an hour later: still the second factor, but sensitive actions ask to confirm again.
    await owner.refreshToken.updateMany({ where: { userId: hrId, revokedAt: null }, data: { authenticatedAt: new Date(Date.now() - 30 * 60_000) } });
    const later = await reload(cookie);
    expect(await mfaOf(later.token)).toBe(true);
    expect((await as(later.token).post('/api/me/passkeys/options')).body.code).toBe('STEP_UP_REQUIRED');
    // Past the refresh token's life, nothing is left to reload.
    await owner.refreshToken.updateMany({ where: { userId: hrId, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', later.cookie)).status).toBe(401);
  });

  it('the older path (no refresh cookie) only marks its own answer; a refresh racing the code still ends marked', async () => {
    const old = await signIn();
    const added = await enrol(old.token, '', '/api/me/passkeys');
    expect(added.status).toBe(201);
    expect(await mfaOf(added.body.accessToken)).toBe(true);
    expect(await mfaOf((await reload(old.cookie)).token)).toBe(false);

    // A reload racing the second factor: whichever lands first, the newest token carries it.
    await owner.passkey.deleteMany({ where: { userId: hrId } });
    const pk = await owner.passkey.create({ data: { tenantId: t.tenant.id, userId: hrId, credentialId: `cred-${randomBytes(4).toString('hex')}`, publicKey: Buffer.from('x'), name: 'Phone' } });
    for (let i = 0; i < 5; i++) {
      resetLimits();
      const s = await signIn();
      const [up, r] = await Promise.all([
        as(s.token, s.cookie).post('/api/auth/step-up', { challengeId: randomUUID(), response: { id: pk.credentialId, who: { userId: hrId } } }),
        request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', s.cookie),
      ]);
      expect(up.status).toBe(200);
      expect(r.status).toBe(200);
      expect(await mfaOf((await reload(cookieOf(r))).token)).toBe(true);
    }
  });
});

describe('Dev console sessions: the second factor lasts the session', () => {
  const ADMIN = `dev-${randomBytes(4).toString('hex')}@flexcity.dev`;
  const ADMIN_PASSWORD = 'correct horse battery';
  let adminId: string;
  const dev = (cookie: string) => ({
    get: (p: string) => request(server).get(p).set('x-fh-platform', '1').set('Cookie', cookie),
    post: (p: string, b: object = {}) => request(server).post(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  });
  const devSignIn = async () => {
    const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email: ADMIN, password: ADMIN_PASSWORD });
    expect(r.status).toBe(200);
    return cookieOf(r);
  };

  beforeAll(async () => {
    process.env.PLATFORM_MFA = 'required';
    adminId = (await owner.platformAdmin.create({ data: { email: ADMIN, name: 'Test Dev', passwordHash: await hashPassword(ADMIN_PASSWORD) } })).id;
  });

  it('a first passkey, then a passkey confirmation, each last through reloads; a new password sign-in starts without', async () => {
    const cookie = await devSignIn();
    expect((await dev(cookie).get('/api/platform/tenants')).body.code).toBe('MFA_REQUIRED');
    const cred = `cred-${randomBytes(4).toString('hex')}`;
    const added = await dev(cookie).post('/api/platform/passkeys', { challengeId: randomUUID(), response: { id: cred, who: { adminId } } });
    expect(added.status).toBe(201);
    // A reload sends the same cookie: the session itself has the second factor.
    for (let i = 0; i < 2; i++) {
      expect((await dev(cookie).get('/api/platform/me')).body).toMatchObject({ mfa: true, mfaRequired: false });
      expect((await dev(cookie).get('/api/platform/tenants')).status).toBe(200);
    }
    // A new password sign-in asks again; the passkey confirmation then lasts too.
    resetLimits();
    const next = await devSignIn();
    expect((await dev(next).get('/api/platform/me')).body).toMatchObject({ mfa: false, mfaRequired: true });
    const ok = await dev(next).post('/api/platform/auth/mfa', { challengeId: randomUUID(), response: { id: cred, who: { adminId } } });
    expect(ok.status).toBe(200);
    expect((await dev(next).get('/api/platform/me')).body).toMatchObject({ mfa: true, mfaRequired: false });
    expect((await dev(next).get('/api/platform/tenants')).status).toBe(200);
    // Signing out ends it.
    await dev(next).post('/api/platform/auth/logout');
    expect((await dev(next).get('/api/platform/me')).status).toBe(401);
  });
});
