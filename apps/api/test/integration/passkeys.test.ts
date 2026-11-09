import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'tau';
const PASSWORD = 'correct horse battery staple';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hrId: string;

async function signIn() {
  const r = await request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email: 'hr@tau.test', password: PASSWORD });
  return { token: r.body.accessToken as string, cookie: String(r.headers['set-cookie']).split(';')[0]! };
}
const as = (token: string, cookie?: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie ?? '').auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie ?? '').auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@tau.test', passwordHash: await hashPassword(PASSWORD) } });
  hrId = h.id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('confirm it’s you (step-up)', () => {
  it('sensitive actions need a recent sign-in; a stale session is asked to confirm', async () => {
    const stale = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) - 11 * 60 });
    const r = await as(stale).get('/api/payroll/export?periodStart=2026-10-04&weeks=2');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('STEP_UP_REQUIRED');
    // Ordinary screens keep working.
    expect((await as(stale).get('/api/users')).status).toBe(200);
    // A token with no sign-in time is never treated as recent.
    const unknown = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'] });
    expect((await as(unknown).post('/api/me/passkeys/options')).body.code).toBe('STEP_UP_REQUIRED');
  });

  it('a fresh password sign-in counts as recent', async () => {
    const { token } = await signIn();
    expect((await as(token).get('/api/payroll/export?periodStart=2026-10-04&weeks=2')).body.code).not.toBe('STEP_UP_REQUIRED');
  });

  it('refreshing keeps the original sign-in time; confirming with the password renews it', async () => {
    const { cookie } = await signIn();
    await owner.refreshToken.updateMany({ where: { userId: hrId }, data: { authenticatedAt: new Date(Date.now() - 30 * 60_000) } });
    const refreshed = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', cookie);
    const token = refreshed.body.accessToken as string;
    const cookie2 = String(refreshed.headers['set-cookie']).split(';')[0]!;
    expect((await as(token).get('/api/payroll/export?periodStart=2026-10-04&weeks=2')).body.code).toBe('STEP_UP_REQUIRED');

    expect((await as(token, cookie2).post('/api/auth/step-up', { password: 'nope' })).body.code).toBe('WRONG_PASSWORD');
    const up = await as(token, cookie2).post('/api/auth/step-up', { password: PASSWORD });
    expect(up.status).toBe(200);
    expect((await as(up.body.accessToken).get('/api/payroll/export?periodStart=2026-10-04&weeks=2')).body.code).not.toBe('STEP_UP_REQUIRED');
    // …and the renewed time survives the next refresh.
    const again = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', cookie2);
    expect((await as(again.body.accessToken).get('/api/payroll/export?periodStart=2026-10-04&weeks=2')).body.code).not.toBe('STEP_UP_REQUIRED');
  });

  it('without a passkey, the passkey step-up says to use the password', async () => {
    const { token } = await signIn();
    expect((await as(token).post('/api/auth/step-up/options')).body.code).toBe('NO_PASSKEY');
  });
});

describe('passkeys', () => {
  it('offers registration bound to this organization’s own address', async () => {
    const { token } = await signIn();
    const r = await as(token).post('/api/me/passkeys/options');
    expect(r.status).toBe(200);
    expect(r.body.options.rp).toEqual({ id: 'tau.localhost', name: 'City of tau · FlexcityHeadquarters' });
    expect(r.body.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(r.body.challengeId).toMatch(/[0-9a-f-]{36}/);
  });

  it('sign-in challenges are single use and unknown passkeys are refused', async () => {
    const opts = await request(server).post('/api/auth/passkey/options').set('x-tenant-subdomain', SUB).send({});
    expect(opts.body.options.rpId).toBe('tau.localhost');
    const fake = { id: 'bm9wZQ', rawId: 'bm9wZQ', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' }, clientExtensionResults: {} };
    const first = await request(server).post('/api/auth/passkey').set('x-tenant-subdomain', SUB).send({ challengeId: opts.body.challengeId, response: fake });
    expect(first.body.code).toBe('PASSKEY_UNKNOWN');
    const replay = await request(server).post('/api/auth/passkey').set('x-tenant-subdomain', SUB).send({ challengeId: opts.body.challengeId, response: fake });
    expect(replay.body.code).toBe('PASSKEY_EXPIRED');
  });

  it('lists my passkeys and removes only my own', async () => {
    const { token } = await signIn();
    const mine = await owner.passkey.create({ data: { tenantId: t.tenant.id, userId: hrId, credentialId: 'cred-hr', publicKey: Buffer.from('x'), name: 'Windows Hello' } });
    const theirs = await owner.passkey.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, credentialId: 'cred-guard', publicKey: Buffer.from('x'), name: 'iPhone' } });
    expect((await as(token).get('/api/me/passkeys')).body).toEqual([expect.objectContaining({ id: mine.id, name: 'Windows Hello' })]);
    expect((await request(server).delete(`/api/me/passkeys/${theirs.id}`).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' })).status).toBe(404);
    expect((await request(server).delete(`/api/me/passkeys/${mine.id}`).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' })).status).toBe(204);
  });
});
