import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'senior';
const EMAIL = 'dev-seniority@flexcity.test';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
let cookie = '';
const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const dev = () => ({
  post: (p: string, b: object) => request(server).post(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
});
const order = async () => ((await as(hr).get(`/api/overtime/standings?positionId=${t.position.id}`)).body.rows as Array<{ name: string; seniorityDate: string | null }>);

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  // Same overtime (none); Guard1 is more senior, so first in line when seniority counts.
  await owner.user.update({ where: { id: t.users[0]!.id }, data: { seniorityDate: new Date('2022-05-01') } });
  await owner.user.update({ where: { id: t.users[1]!.id }, data: { seniorityDate: new Date('2015-05-01') } });
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'X', email: `hr@${SUB}.test` } });
  hr = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
  await owner.platformAdmin.create({ data: { email: EMAIL, name: 'Dev', passwordHash: await hashPassword('correct horse battery') } });
  cookie = String((await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email: EMAIL, password: 'correct horse battery' })).headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('seniority, chosen by each organization', () => {
  it('is on for cities: ties in the overtime order go to the more senior person', async () => {
    expect((await as(hr).get('/api/settings/seniority')).body).toEqual({ useSeniority: true });
    const rows = await order();
    expect(rows.map((r) => r.name)).toEqual([`Guard1 ${SUB}`, `Guard0 ${SUB}`]);
    expect(rows[0]!.seniorityDate).toBe('2015-05-01');
  });

  it('the organization can turn it off: no seniority shown, ties go by name', async () => {
    expect((await as(hr).put('/api/settings/seniority', { useSeniority: false })).status).toBe(200);
    expect((await as(hr).get('/api/me')).body.features.seniority).toBe(false);
    const rows = await order();
    expect(rows.map((r) => r.name)).toEqual([`Guard0 ${SUB}`, `Guard1 ${SUB}`]);
    expect(rows.every((r) => r.seniorityDate === null)).toBe(true);
    expect(await owner.auditLog.count({ where: { action: 'settings.seniority', tenantId: t.tenant.id } })).toBe(1);
  });

  it('the Dev console can switch it back on', async () => {
    expect((await dev().patch(`/api/platform/tenants/${t.tenant.id}`, { features: { seniority: true } })).status).toBe(200);
    expect((await as(hr).get('/api/settings/seniority')).body).toEqual({ useSeniority: true });
    expect((await order())[0]!.name).toBe(`Guard1 ${SUB}`);
  });

  it('a new private-sector company starts without it', async () => {
    const facility = { name: 'Gym', province: 'ON', timezone: 'America/Toronto', latitude: null, longitude: null, geoRadiusM: 150, costCenter: 'G-1' };
    const r = await dev().post('/api/platform/tenants', { name: 'Peak Fitness Inc.', subdomain: 'peakfit', sector: 'private', facility });
    expect(r.status).toBe(201);
    const made = await owner.tenant.findUniqueOrThrow({ where: { subdomain: 'peakfit' } });
    expect((made.features as Record<string, boolean>).seniority).toBe(false);
  });
});
