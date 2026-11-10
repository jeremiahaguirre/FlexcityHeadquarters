import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'fleet';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', driver: '', other: '' };
let hrId: string;
let licence: string;
let plow: string;
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const allOk = ['BRAKES', 'STEERING', 'LIGHTS', 'TIRES_WHEELS'].map((item) => ({ item, ok: true }));

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  licence = (await owner.certification.create({ data: { tenantId: t.tenant.id, name: 'Class 3 with air brakes', issuingBody: 'ICBC' } })).id;
  const mk = async (roles: ('HR_ADMIN' | 'EMPLOYEE')[], name: string, licensed: boolean) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@fleet.test` } });
    if (licensed) await owner.userCertification.create({ data: { tenantId: t.tenant.id, userId: u.id, certificationId: licence, issueDate: new Date('2024-01-01'), verifiedAt: new Date() } });
    return { id: u.id, token: await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) }) };
  };
  const hr = await mk(['HR_ADMIN'], 'hr', false);
  hrId = hr.id;
  tok.hr = hr.token;
  tok.driver = (await mk(['EMPLOYEE'], 'dee', true)).token;
  tok.other = (await mk(['EMPLOYEE'], 'ollie', false)).token;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('fleet', () => {
  it('a vehicle needs a pre-trip inspection to be ready', async () => {
    const v = await call(tok.hr).post('/api/vehicles', { unit: 'P-12', description: 'Tandem plow truck', certificationId: licence });
    expect(v.status).toBe(201);
    plow = v.body.id;
    expect((await call(tok.driver).get('/api/vehicles')).body.vehicles[0]).toMatchObject({ unit: 'P-12', status: 'NEEDS_INSPECTION' });
  });

  it('only licensed drivers inspect it; a pass makes it ready', async () => {
    expect((await call(tok.other).post(`/api/vehicles/${plow}/inspections`, { items: allOk })).body.code).toBe('LICENCE_REQUIRED');
    const r = await call(tok.driver).post(`/api/vehicles/${plow}/inspections`, { odometerKm: 84213, items: allOk });
    expect(r.body.result).toBe('PASS');
    expect((await call(tok.driver).get('/api/vehicles')).body.vehicles[0].status).toBe('READY');
  });

  it('a major defect takes it out of service and tells the fleet managers', async () => {
    expect((await call(tok.driver).post(`/api/vehicles/${plow}/inspections`, { items: [{ item: 'BRAKES', ok: false }] })).body.code).toBe('NEEDS_SEVERITY');
    const r = await call(tok.driver).post(`/api/vehicles/${plow}/inspections`, { items: [...allOk.slice(1), { item: 'BRAKES', ok: false, severity: 'MAJOR', note: 'Air leak at the front chamber' }] });
    expect(r.body.result).toBe('MAJOR');
    expect((await call(tok.driver).get('/api/vehicles')).body.vehicles[0]).toMatchObject({ status: 'OUT_OF_SERVICE', outOfServiceReason: 'BRAKES: Air leak at the front chamber' });
    expect(await owner.notification.count({ where: { userId: hrId, type: 'vehicle_out_of_service' } })).toBe(1);
  });

  it('a supervisor records the repair to return it to service', async () => {
    expect((await call(tok.driver).post(`/api/vehicles/${plow}/return`, { note: 'Fixed' })).status).toBe(403);
    expect((await call(tok.hr).post(`/api/vehicles/${plow}/return`, { note: 'Brake chamber replaced, shop WO 4471' })).status).toBe(200);
    const history = (await call(tok.hr).get(`/api/vehicles/${plow}/inspections`)).body;
    expect(history[0]).toMatchObject({ result: 'MAJOR', repairNote: 'Brake chamber replaced, shop WO 4471', driver: 'dee X' });
    expect((await call(tok.driver).get('/api/vehicles')).body.vehicles[0].status).toBe('NEEDS_INSPECTION');
  });
});

describe('hours of service on driving positions', () => {
  it('blocks booking a driver past the position’s limits', async () => {
    const pos = await call(tok.hr).post('/api/positions', { name: 'Plow Operator', requiredCertificationIds: [], hoursOfService: { maxDailyHours: 13, minRestHours: 8, maxHoursIn7Days: 70 } });
    expect(pos.status).toBe(201);
    const driver = await owner.user.findFirstOrThrow({ where: { email: 'dee@fleet.test' } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: driver.id, positionId: pos.body.id } });
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: pos.body.id, userId: driver.id, startsAt: new Date(`${day}T10:00:00Z`), endsAt: new Date(`${day}T20:00:00Z`), status: 'PUBLISHED' } });
    const night = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: pos.body.id, startsAt: new Date(`${day}T23:00:00Z`), endsAt: new Date(new Date(`${day}T23:00:00Z`).getTime() + 6 * 3_600_000), status: 'PUBLISHED' } });
    const sup = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: Math.floor(Date.now() / 1000) });
    const r = await call(sup).get(`/api/shifts/${night.id}/candidates`);
    const list = Array.isArray(r.body) ? r.body : r.body.candidates;
    const dee = list.find((c: { user: { id: string } }) => c.user.id === driver.id);
    expect(dee.eligible).toBe(false);
    expect(dee.blocks.map((b: { code: string }) => b.code)).toContain('HOS_REST');
  });
});
