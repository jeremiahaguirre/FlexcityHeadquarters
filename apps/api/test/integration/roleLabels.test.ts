/**
 * Words for the built-in roles: an organization's profile (aquatic, municipal, private employer),
 * its own EN/FR names for each role, and the Dev console import not reading "supervisor" as a pool
 * supervisor where there are no pools.
 */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'rolewords';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', guard: '', scoped: '' };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const vocab = async () => (await call(tok.guard).get('/api/me')).body.vocabulary as { profile: string; roleLabels: Record<string, { en: string; fr: string }> };
let dev: (p: string, b: object) => request.Test;

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
  const hr = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: `hr@${SUB}.test` } });
  tok.hr = await signAccessToken({ sub: hr.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Branch admin', permissions: ['tenant.configure', 'users.read'], scopePositionIds: [t.position.id] } });
  const scoped = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'A', email: `scoped@${SUB}.test` } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: scoped.id, customRoleId: role.id } });
  forgetCustomPermissions(t.tenant.id);
  tok.scoped = await signAccessToken({ sub: scoped.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
  const email = `dev-${randomBytes(3).toString('hex')}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'Dev', passwordHash: await hashPassword('right password!') } });
  const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  dev = (p, b) => request(server).post(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(b);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const CSV = 'first_name,last_name,email,roles\nAna,One,ana@rolewords.test,supervisor\nBo,Two,bo@rolewords.test,staff\nCy,Three,cy@rolewords.test,\n';
const rolesOf = async () => {
  const r = await dev(`/tenants/${t.tenant.id}/import/preview`, { csv: CSV });
  expect(r.status).toBe(200);
  return (r.body.rows as Array<{ roles: string[]; customRoleIds: string[]; errors: Array<{ code: string }> }>).map((x) => [x.roles, x.customRoleIds.length, x.errors.map((e) => e.code)]);
};

describe('profile', () => {
  it('an organization still being set up (no departments, no pools) keeps the words and the import as before', async () => {
    expect(await vocab()).toEqual({ profile: 'AQUATIC', chosen: null, roleLabels: {} });
    expect(await rolesOf()).toEqual([
      [['AQUATIC_SUPERVISOR'], 0, []],
      [['STAFF'], 0, []],
      [['STAFF'], 0, []],
    ]);
  });

  it('with departments and no pools it uses neutral words, and the import doesn’t make pool supervisors', async () => {
    await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Library' } });
    expect(await vocab()).toEqual({ profile: 'MUNICIPAL', chosen: null, roleLabels: {} });
    expect(await rolesOf()).toEqual([
      [['EMPLOYEE'], 0, ['POOL_ROLE']],
      [['EMPLOYEE'], 0, []],
      [['EMPLOYEE'], 0, []],
    ]);
  });

  it('“supervisor” names the organization’s own role when it has one by that name', async () => {
    const own = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Supervisor', permissions: ['schedule.read'] } });
    expect((await rolesOf())[0]).toEqual([['EMPLOYEE'], 1, []]);
    await owner.customRole.delete({ where: { id: own.id } });
  });

  it('with an aquatic department it is aquatic, and the import keeps its old meaning', async () => {
    const d = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
    expect((await vocab()).profile).toBe('AQUATIC');
    expect(await rolesOf()).toEqual([
      [['AQUATIC_SUPERVISOR'], 0, []],
      [['STAFF'], 0, []],
      [['STAFF'], 0, []],
    ]);
    await owner.department.delete({ where: { id: d.id } });
  });

  it('a private employer gets workplace words', async () => {
    await owner.billingAccount.create({ data: { tenantId: t.tenant.id, plan: 'CLUB', legalName: 'Example Co.', email: 'billing@example.test', province: 'BC' } });
    expect((await vocab()).profile).toBe('PRIVATE');
    await owner.billingAccount.delete({ where: { tenantId: t.tenant.id } });
  });
});

describe('the organization’s own names', () => {
  it('HR names roles in English and French, and can choose the default words; every screen gets them through /api/me; audited', async () => {
    const r = await call(tok.hr).put('/api/settings/role-labels', { profile: 'PRIVATE', roleLabels: { STAFF: { en: 'Library assistant', fr: 'Aide-bibliothécaire' }, HEAD_LIFEGUARD: null } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ profile: 'PRIVATE', chosen: 'PRIVATE', roleLabels: { STAFF: { en: 'Library assistant', fr: 'Aide-bibliothécaire' } } });
    expect((await vocab()).profile).toBe('PRIVATE');
    // Back to working it out (the library department makes it municipal).
    expect((await call(tok.hr).put('/api/settings/role-labels', { profile: null, roleLabels: { STAFF: { en: 'Library assistant', fr: 'Aide-bibliothécaire' } } })).body.profile).toBe('MUNICIPAL');
    expect((await vocab()).roleLabels.STAFF).toEqual({ en: 'Library assistant', fr: 'Aide-bibliothécaire' });
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'settings.role_labels' } })).toBe(2);
  });

  it('refuses half a name, an unknown role, a department-limited admin and staff', async () => {
    const put = (token: string, roleLabels: object, profile: string | null = null) => call(token).put('/api/settings/role-labels', { profile, roleLabels });
    expect((await put(tok.hr, { STAFF: { en: 'Only English' } })).status).toBe(400);
    expect((await put(tok.hr, { CHIEF: { en: 'Chief', fr: 'Chef' } })).status).toBe(400);
    expect((await put(tok.hr, {}, 'POOLSIDE')).status).toBe(400);
    expect((await put(tok.scoped, { STAFF: { en: 'Mine', fr: 'Le mien' } })).status).toBe(403);
    expect((await put(tok.guard, { STAFF: { en: 'Mine', fr: 'Le mien' } })).status).toBe(403);
    expect((await vocab()).roleLabels.STAFF!.en).toBe('Library assistant');
  });
});
