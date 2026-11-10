import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { forgetTenantLookup } from '../../src/routes/context.js';
import { purgeTenant } from '../../src/services/platform/purge.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'lifecity';
let t: Awaited<ReturnType<typeof seedTenant>>;
let cookie = '';
let hr = '';
const dev = (m: 'get' | 'post', p: string, b?: object) => request(server)[m](`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(b);
const city = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});
const codeOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('code')!);
const redeem = (code: string) => request(server).post('/api/auth/support').set('x-tenant-subdomain', SUB).send({ code });

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const email = `life-${randomBytes(3).toString('hex')}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'Sam Support', passwordHash: await hashPassword('right password!') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'R', email: `hr@${SUB}.test`, unionMember: true } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa: true });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('passkey step-up in the Dev console', () => {
  it('sensitive actions need a passkey confirmation from the last 10 minutes', async () => {
    const before = process.env.PLATFORM_MFA;
    process.env.PLATFORM_MFA = 'required';
    try {
      // Signed in with a password only: everything asks for the passkey first.
      expect((await dev('post', `/api/platform/tenants/${t.tenant.id}/disable`.replace('/api/platform', ''), { reason: 'test' })).body.code).toMatch(/MFA_REQUIRED|PASSKEY_STEP_UP/);
      // With a passkey confirmed 20 minutes ago: still asked again for this.
      await owner.platformSession.updateMany({ where: { revokedAt: null }, data: { mfaAt: new Date(Date.now() - 20 * 60_000) } });
      expect((await dev('post', `/tenants/${t.tenant.id}/disable`, { reason: 'test' })).body.code).toBe('PASSKEY_STEP_UP');
      expect((await dev('get', `/tenants/${t.tenant.id}/lifecycle`)).status).toBe(200); // reading isn't sensitive
    } finally {
      process.env.PLATFORM_MFA = before;
    }
  });
});

describe('support access, only with consent', () => {
  let grantId = '';
  it('no visit without the organization’s permission', async () => {
    expect((await dev('post', `/tenants/${t.tenant.id}/support-visit`)).body.code).toBe('NO_CONSENT');
  });

  it('HR allows set-up access; the visit is read-only, shows as FH support, and every page is logged', async () => {
    const g = await city(hr).post('/api/support-access', { hours: 2, level: 'SETUP', reason: 'Menus look wrong' });
    expect(g.status).toBe(201);
    grantId = g.body.id;
    const v = await dev('post', `/tenants/${t.tenant.id}/support-visit`);
    expect(v.status).toBe(201);
    const code = codeOf(v.body.url);
    const s = await redeem(code);
    expect(s.status).toBe(200);
    expect((await redeem(code)).body.code).toBe('SUPPORT_CODE_INVALID'); // one use only
    const sup = s.body.accessToken as string;
    const me = (await city(sup).get('/api/me')).body;
    expect(me).toMatchObject({ firstName: 'FH', lastName: 'support', email: '', support: { admin: 'Sam Support', level: 'SETUP' } });
    expect(me.permissions).not.toContain('users.read');
    expect(me.permissions).not.toContain('union.hub');
    expect((await city(sup).get('/api/users')).status).toBe(403); // people's records aren't part of set-up access
    expect((await city(sup).get('/api/union/locals')).status).toBe(403); // never, whoever allowed it
    expect((await city(sup).post('/api/support-access', { hours: 1, level: 'FULL' })).body.code).toBe('SUPPORT_READ_ONLY');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'support.view' } })).toBeGreaterThanOrEqual(3);
    expect((await city(hr).get('/api/support-access')).body.visits[0]).toMatchObject({ admin: 'Sam Support' });
  });

  it('withdrawing permission ends the visit at once', async () => {
    const v = await dev('post', `/tenants/${t.tenant.id}/support-visit`);
    const sup = (await redeem(codeOf(v.body.url))).body.accessToken as string;
    expect((await city(sup).get('/api/me')).status).toBe(200);
    expect((await city(hr).del(`/api/support-access/${grantId}`)).status).toBe(200);
    expect((await city(sup).get('/api/me')).body.code).toBe('SUPPORT_ENDED');
  });

  it('full access lets support read what HR reads, still without changing anything', async () => {
    await city(hr).post('/api/support-access', { hours: 1, level: 'FULL' });
    const v = await dev('post', `/tenants/${t.tenant.id}/support-visit`);
    const sup = (await redeem(codeOf(v.body.url))).body.accessToken as string;
    expect((await city(sup).get('/api/users')).status).toBe(200);
    expect((await city(sup).post(`/api/users/${t.users[0]!.id}/documents`, {})).body.code).toBe('SUPPORT_READ_ONLY');
  });
});

describe('closing an organization', () => {
  it('disabling stops sign-in and every page; enabling restores it', async () => {
    expect((await dev('post', `/tenants/${t.tenant.id}/disable`, { reason: 'Unpaid since June' })).status).toBe(200);
    forgetTenantLookup();
    expect((await city(hr).get('/api/me')).body.code).toBe('ORG_DISABLED');
    expect((await request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email: `hr@${SUB}.test`, password: 'x' })).body.code).toBe('ORG_DISABLED');
    expect((await dev('post', `/tenants/${t.tenant.id}/enable`)).status).toBe(200);
    expect((await city(hr).get('/api/me')).status).toBe(200);
  });

  it('offboarding needs the address typed; after the retention date the data is deleted, invoices kept', async () => {
    const other = await seedTenant('purgecity', 2);
    expect((await dev('post', `/tenants/${other.tenant.id}/offboard`, { reason: 'Contract ended', confirm: 'wrong' })).body.code).toBe('CONFIRM_MISMATCH');
    const o = await dev('post', `/tenants/${other.tenant.id}/offboard`, { reason: 'Contract ended', confirm: 'purgecity', retentionDays: 30 });
    expect(o.body.deleteAfter).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await owner.invoice.create({ data: { tenantId: other.tenant.id, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), billTo: { legalName: 'Purge City' }, createdById: other.users[0]!.id } });
    await expect(purgeTenant(owner, other.tenant.id)).rejects.toThrow(/retention period/);
    const r = await purgeTenant(owner, other.tenant.id, { force: true });
    expect(r.deleted).toBeGreaterThan(5);
    expect(await owner.user.count({ where: { tenantId: other.tenant.id } })).toBe(0);
    expect(await owner.facility.count({ where: { tenantId: other.tenant.id } })).toBe(0);
    expect(await owner.invoice.count({ where: { tenantId: other.tenant.id } })).toBe(1);
  });
});
