import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'mfa';
const PASSWORD = 'correct horse battery staple';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hrId: string;

const signIn = async () => {
  const r = await request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email: 'hr@mfa.test', password: PASSWORD });
  return { token: r.body.accessToken as string, cookie: String(r.headers['set-cookie']).split(';')[0]! };
};
const as = (token: string, cookie = '') => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie).auth(token, { type: 'bearer' }).send(b),
  delete: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie).auth(token, { type: 'bearer' }),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { mfaRoles: ['HR_ADMIN'] } });
  forgetFeatures(t.tenant.id);
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@mfa.test', passwordHash: await hashPassword(PASSWORD) } })).id;
});
afterEach(async () => {
  await owner.passkey.deleteMany({ where: { userId: hrId } });
});
afterAll(async () => {
  delete process.env.PLATFORM_MFA;
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('cities: a passkey required for chosen access levels', () => {
  it('a password alone reaches only enough to give the second factor', async () => {
    const { token } = await signIn();
    const blocked = await as(token).get('/api/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
    const me = await as(token).get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.mfaRequired).toBe(true);
    // No passkey yet: they may set up their first one.
    expect((await as(token).post('/api/me/passkeys/options')).status).toBe(200);
    // A password can't stand in for the missing factor.
    expect((await as(token).post('/api/auth/step-up', { password: PASSWORD })).body.code).toBe('MFA_REQUIRED');
  });

  it('once a passkey exists, a password-only session can’t add or remove passkeys', async () => {
    const pk = await owner.passkey.create({ data: { tenantId: t.tenant.id, userId: hrId, credentialId: `c-${randomBytes(4).toString('hex')}`, publicKey: Buffer.from('x'), name: 'Phone' } });
    const { token } = await signIn();
    expect((await as(token).post('/api/me/passkeys/options')).body.code).toBe('MFA_REQUIRED');
    expect((await as(token).delete(`/api/me/passkeys/${pk.id}`)).body.code).toBe('MFA_REQUIRED');
    // It can ask to confirm with that passkey.
    expect((await as(token).post('/api/auth/step-up/options')).status).toBe(200);
  });

  it('a session with a passkey gets everything, and keeps it through refresh', async () => {
    const mfa = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa: true });
    expect((await as(mfa).get('/api/users')).status).toBe(200);
    expect((await as(mfa).get('/api/me')).body.mfaRequired).toBe(false);

    const { cookie } = await signIn();
    await owner.refreshToken.updateMany({ where: { userId: hrId, revokedAt: null }, data: { mfaAt: new Date() } });
    const refreshed = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', cookie);
    expect((await as(refreshed.body.accessToken).get('/api/users')).status).toBe(200);
  });

  it('access levels the city didn’t choose are unaffected', async () => {
    const guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
    expect((await as(guard).get('/api/me')).body.mfaRequired).toBe(false);
    expect((await as(guard).get('/api/me/schedule')).status).not.toBe(403);
  });
});

describe('Dev console: a passkey is always the second factor', () => {
  const email = `mfa-${randomBytes(4).toString('hex')}@flexcity.dev`;
  let adminId: string;
  let cookie: string;
  const dev = () => ({
    get: (p: string) => request(server).get(p).set('x-fh-platform', '1').set('Cookie', cookie),
    post: (p: string, b: object = {}) => request(server).post(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
    put: (p: string, b: object) => request(server).put(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  });

  beforeAll(async () => {
    process.env.PLATFORM_MFA = 'required';
    adminId = (await owner.platformAdmin.create({ data: { email, name: 'MFA Dev', passwordHash: await hashPassword('right password!') } })).id;
    const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    expect(r.body).toMatchObject({ mfaRequired: true, hasPasskey: false });
    cookie = String(r.headers['set-cookie']).split(';')[0]!;
  });

  it('a password sign-in can only set up a first passkey', async () => {
    expect((await dev().get('/api/platform/tenants')).body.code).toBe('MFA_REQUIRED');
    expect((await dev().get('/api/platform/me')).body).toMatchObject({ mfaRequired: true, hasPasskey: false });
    expect((await dev().post('/api/platform/passkeys/options')).status).toBe(200);
  });

  it('with a passkey on file, the password session must confirm with it', async () => {
    await owner.platformPasskey.create({ data: { adminId, credentialId: `p-${randomBytes(4).toString('hex')}`, publicKey: Buffer.from('x'), name: 'Laptop' } });
    expect((await dev().post('/api/platform/passkeys/options')).body.code).toBe('MFA_REQUIRED');
    const opts = await dev().post('/api/platform/auth/mfa/options');
    expect(opts.status).toBe(200);
    expect(opts.body.options.allowCredentials).toHaveLength(1);
  });

  it('after the second factor, the console opens and can require passkeys per access level', async () => {
    await owner.platformSession.updateMany({ where: { adminId }, data: { mfaAt: new Date() } });
    expect((await dev().get('/api/platform/tenants')).status).toBe(200);
    const on = await dev().put(`/api/platform/tenants/${t.tenant.id}/access/mfa`, { role: 'AQUATIC_SUPERVISOR', required: true });
    expect(on.status).toBe(200);
    expect(on.body.roles.find((r: { role: string }) => r.role === 'AQUATIC_SUPERVISOR').mfa).toBe(true);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).mfaRoles).toEqual(['HR_ADMIN', 'AQUATIC_SUPERVISOR']);
    await dev().put(`/api/platform/tenants/${t.tenant.id}/access/mfa`, { role: 'AQUATIC_SUPERVISOR', required: false });
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).mfaRoles).toEqual(['HR_ADMIN']);
  });

  it('new organizations start with a passkey required for HR', async () => {
    const sub = `m${randomBytes(3).toString('hex')}`;
    const r = await dev().post('/api/platform/tenants', { name: 'Town', subdomain: sub, defaultLocale: 'en-CA', facility: { name: 'Pool', province: 'ON', timezone: 'America/Toronto', latitude: null, longitude: null, geoRadiusM: 150, costCenter: 'A' } });
    expect(r.status).toBe(201);
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: r.body.id } })).mfaRoles).toEqual(['HR_ADMIN']);
  });
});
