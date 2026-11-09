import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'accessctl';
const EMAIL = `dev-${randomBytes(4).toString('hex')}@flexcity.dev`;
let cookie: string;
let t: Awaited<ReturnType<typeof seedTenant>>;
let staff: string;
const dev = () => ({
  get: (p: string) => request(server).get(p).set('x-fh-platform', '1').set('Cookie', cookie),
  put: (p: string, b: object) => request(server).put(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  post: (p: string, b: object) => request(server).post(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
});
const as = (token: string) => ({ get: (p: string) => request(server).get(p).auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB) });

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  await owner.platformAdmin.create({ data: { email: EMAIL, name: 'Dev', passwordHash: await hashPassword('correct horse battery') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email: EMAIL, password: 'correct horse battery' });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
  staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('menus and access per role, from the Dev console', () => {
  it('lists every role with its menu and permissions', async () => {
    const r = await dev().get(`/api/platform/tenants/${t.tenant.id}/access`);
    const staffRow = r.body.roles.find((x: { role: string }) => x.role === 'STAFF');
    expect(staffRow.menu.find((m: { href: string }) => m.href === '/board').shown).toBe(true);
    expect(staffRow.menu.find((m: { href: string }) => m.href === '/manage/payroll').shown).toBe(false);
    expect(r.body.menu.length).toBeGreaterThan(20);
  });

  it('switching a menu item off hides it and the API refuses that screen; on brings both back', async () => {
    expect((await as(staff).get('/api/shiftboard/offers')).status).toBe(200);
    const off = await dev().put(`/api/platform/tenants/${t.tenant.id}/access/menu`, { role: 'STAFF', href: '/board', shown: false });
    expect(off.status).toBe(200);
    const me = await as(staff).get('/api/me');
    expect(me.body.hiddenMenu).toContain('/board');
    expect(me.body.permissions).not.toContain('shiftboard.claim');
    expect((await as(staff).get('/api/shiftboard/offers')).status).toBe(403);

    await dev().put(`/api/platform/tenants/${t.tenant.id}/access/menu`, { role: 'STAFF', href: '/board', shown: true });
    expect((await as(staff).get('/api/me')).body.hiddenMenu).toEqual([]);
    expect((await as(staff).get('/api/shiftboard/offers')).status).toBe(200);
  });

  it('hiding Today keeps My schedule working (they share a permission)', async () => {
    await dev().put(`/api/platform/tenants/${t.tenant.id}/access/menu`, { role: 'STAFF', href: '/today', shown: false });
    const me = (await as(staff).get('/api/me')).body;
    expect(me.hiddenMenu).toEqual(['/today']);
    expect(me.permissions).toContain('shifts.self');
  });

  it('a menu item can be added to a role that never had it', async () => {
    await dev().put(`/api/platform/tenants/${t.tenant.id}/access/menu`, { role: 'STAFF', href: '/manage/compliance', shown: true });
    expect((await as(staff).get('/api/me')).body.permissions).toContain('compliance.report');
  });

  it('individual permissions toggle too, every change is audited, and reset restores the defaults', async () => {
    await dev().put(`/api/platform/tenants/${t.tenant.id}/access/permission`, { role: 'STAFF', permission: 'timeclock.punch', on: false });
    expect((await as(staff).get('/api/me')).body.permissions).not.toContain('timeclock.punch');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: { startsWith: 'platform.access.' } } })).toBe(5);
    const reset = await dev().post(`/api/platform/tenants/${t.tenant.id}/access/reset`, { role: 'STAFF' });
    expect(reset.body.roles.find((x: { role: string }) => x.role === 'STAFF').customized).toBe(false);
    const me = (await as(staff).get('/api/me')).body;
    expect(me.permissions).toContain('timeclock.punch');
    expect(me.permissions).not.toContain('compliance.report');
    expect(me.hiddenMenu).toEqual([]);
  });

  it('only the Dev console can change access', async () => {
    expect((await request(server).put(`/api/platform/tenants/${t.tenant.id}/access/menu`).auth(staff, { type: 'bearer' }).set('x-fh-platform', '1').send({ role: 'STAFF', href: '/board', shown: false })).status).toBe(401);
  });
});
