import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'upsilon';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let worker: { id: string; token: string };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@upsilon.test' } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now() });
  const w = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Wes', lastName: 'Water', email: 'wes@upsilon.test' } });
  worker = { id: w.id, token: await signAccessToken({ sub: w.id, tid: t.tenant.id, roles: ['EMPLOYEE'] }) };
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('general employees and the city’s own roles', () => {
  it('a general employee gets their own work screens and nothing aquatic', async () => {
    const perms: string[] = (await call(worker.token).get('/api/me')).body.permissions;
    expect(perms).toEqual(expect.arrayContaining(['shifts.self', 'timeclock.punch', 'timeoff.self', 'availability.self']));
    for (const p of ['ops.status.read', 'ops.chemical.record', 'incidents.create', 'lessons.teach', 'shiftboard.claim']) expect(perms).not.toContain(p);
    expect((await call(worker.token).get('/api/ops/pools')).status).toBe(403);
  });

  it('HR defines a role; pool permissions are refused whatever is sent', async () => {
    const bad = await call(hr).post('/api/roles', { name: 'Sneaky', permissions: ['shifts.self', 'ops.chemical.record', 'payroll.export'] });
    expect(bad.status).toBe(400);
    expect(bad.body.details.permissions).toEqual(['ops.chemical.record', 'payroll.export']);
    const r = await call(hr).post('/api/roles', { name: 'Maintenance Lead', nameFr: 'Chef d’entretien', permissions: ['shifts.self', 'shiftboard.claim', 'timeoff.approve', 'timeclock.review'] });
    expect(r.status).toBe(201);
    expect((await call(hr).post('/api/roles', { name: 'maintenance lead', permissions: ['shifts.self'] })).body.code).toBe('ROLE_EXISTS');

    // Assigning it adds those permissions on top of the general employee base.
    expect((await call(hr).patch(`/api/users/${worker.id}`, { customRoleIds: [r.body.id] })).status).toBe(200);
    const me = (await call(worker.token).get('/api/me')).body;
    expect(me.customRoles).toEqual([{ id: r.body.id, name: 'Maintenance Lead', nameFr: 'Chef d’entretien' }]);
    expect(me.permissions).toEqual(expect.arrayContaining(['shiftboard.claim', 'timeoff.approve', 'timeclock.review']));
    expect(me.permissions).not.toContain('ops.status.read');
    expect((await call(worker.token).get('/api/time-off')).status).toBe(200);

    // Editing the role changes what holders can do; deleting it takes it away.
    await call(hr).put(`/api/roles/${r.body.id}`, { name: 'Maintenance Lead', permissions: ['shifts.self'] });
    expect((await call(worker.token).get('/api/time-off')).status).toBe(403);
    expect((await call(hr).get('/api/roles')).body.roles).toEqual([expect.objectContaining({ name: 'Maintenance Lead', members: 1 })]);
    await request(server).delete(`/api/roles/${r.body.id}`).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' });
    expect((await call(worker.token).get('/api/me')).body.customRoles).toEqual([]);
  });

  it('staff can’t define roles', async () => {
    expect((await call(worker.token).post('/api/roles', { name: 'Boss', permissions: ['shifts.self'] })).status).toBe(403);
  });

  it('the Dev console defines roles too, and the CSV import assigns them by name', async () => {
    const email = `dev-${randomBytes(3).toString('hex')}@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'D', passwordHash: await hashPassword('right password!') } });
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const dev = (m: 'get' | 'post', p: string, b?: object) => request(server)[m](`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(b);
    expect((await dev('post', `/tenants/${t.tenant.id}/roles`, { name: 'Water Works Operator', nameFr: 'Opérateur, réseau d’aqueduc', permissions: ['schedule.read', 'shifts.self', 'timeclock.punch'] })).status).toBe(201);
    expect((await dev('post', `/tenants/${t.tenant.id}/roles`, { name: 'Bad', permissions: ['ops.pool.close'] })).status).toBe(400);
    const city = await dev('get', `/tenants/${t.tenant.id}`);
    expect(city.body.customRoles.map((r: { name: string }) => r.name)).toEqual(['Water Works Operator']);

    const csv = 'first_name,last_name,email,roles\nOli,Pipe,oli@upsilon.test,Opérateur réseau d’aqueduc\nPia,Pipe,pia@upsilon.test,water works operator';
    const done = await dev('post', `/tenants/${t.tenant.id}/import`, { csv });
    expect(done.body).toMatchObject({ created: 1, errors: 1 }); // the French name must match exactly
    const pia = await owner.user.findFirstOrThrow({ where: { email: 'pia@upsilon.test' } });
    expect(pia.roles).toEqual(['EMPLOYEE']);
    expect(await owner.userCustomRole.count({ where: { userId: pia.id } })).toBe(1);
  });
});
