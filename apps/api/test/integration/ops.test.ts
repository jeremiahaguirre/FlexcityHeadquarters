import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'kappa';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
let head: string;
let staff: string;
let poolId: string;

const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const THRESHOLDS = { freeChlorineMinPpm: '1.0', freeChlorineMaxPpm: '5.0', combinedChlorineMaxPpm: '0.5', phMin: '7.2', phMax: '7.8', thresholdSource: 'Facility permit 2026', bathersPerLifeguard: 50 };

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const mk = async (role: 'AQUATIC_SUPERVISOR' | 'HEAD_LIFEGUARD', email: string) =>
    owner.user.create({ data: { tenantId: t.tenant.id, roles: [role], employmentStatus: 'FULL_TIME', firstName: role, lastName: 'K', email } });
  const s = await mk('AQUATIC_SUPERVISOR', 'sup@kappa.test');
  const h = await mk('HEAD_LIFEGUARD', 'head@kappa.test');
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  head = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HEAD_LIFEGUARD'] });
  staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('pool operations', () => {
  it('rejects inverted or missing thresholds', async () => {
    const bad = await call(sup).post('/api/ops/pools', { ...THRESHOLDS, facilityId: t.facility.id, name: 'Main', kind: 'POOL', phMin: '7.9' });
    expect(bad.status).toBe(400);
    const none = await call(sup).post('/api/ops/pools', { ...THRESHOLDS, facilityId: t.facility.id, name: 'Main', kind: 'POOL', freeChlorineMinPpm: null, phMin: null, phMax: null });
    expect(none.status).toBe(400);
  });

  it('a supervisor sets up a pool from its permit; staff cannot', async () => {
    expect((await call(staff).post('/api/ops/pools', { ...THRESHOLDS, facilityId: t.facility.id, name: 'Main', kind: 'POOL' })).status).toBe(403);
    const r = await call(sup).post('/api/ops/pools', { ...THRESHOLDS, facilityId: t.facility.id, name: 'Main Tank', kind: 'POOL' });
    expect(r.status).toBe(201);
    poolId = r.body.id;
  });

  it('an out-of-range reading recommends closure and shows lifeguards needed', async () => {
    const r = await call(staff).post('/api/ops/readings', { poolBodyId: poolId, freeChlorinePpm: '0.6', totalChlorinePpm: '0.8', ph: '7.4', batherCount: 120 });
    expect(r.body.outOfRange).toBe(true);
    const pools = await call(staff).get('/api/ops/pools');
    expect(pools.status).toBe(403); // staff record readings but the board is for leads and front desk
    const lead = await call(head).get('/api/ops/pools');
    expect(lead.body[0]).toMatchObject({ status: 'CLOSURE_RECOMMENDED', lifeguardsRequired: 3, configured: true });
    expect(lead.body[0].lastReading).toMatchObject({ freeChlorinePpm: '0.6', outOfRange: true });
  });

  it('readings are signed off by someone other than the recorder', async () => {
    const list = await call(staff).get(`/api/ops/readings?from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`);
    const id = list.body[0].id;
    expect(list.body[0].recordedBy).toBe('Guard0 k.');
    const head2 = await call(head).post(`/api/ops/readings/${id}/signoff`);
    expect(head2.status).toBe(200);
  });

  it('a head lifeguard confirms the closure, then reopens after a good retest', async () => {
    expect((await call(head).post(`/api/ops/pools/${poolId}/closure`, { action: 'CONFIRM' })).status).toBe(200);
    expect((await owner.poolBody.findUniqueOrThrow({ where: { id: poolId } })).status).toBe('CLOSED');
    expect((await call(head).post(`/api/ops/pools/${poolId}/closure`, { action: 'REOPEN' })).status).toBe(200);
    expect((await owner.poolBody.findUniqueOrThrow({ where: { id: poolId } })).status).toBe('OPEN');
  });

  it('lists incidents as metadata and counts how often each was opened', async () => {
    const created = await call(staff).post('/api/incidents', {
      facilityId: t.facility.id, occurredAt: new Date().toISOString(), category: 'FIRST_AID',
      narrative: { summary: 'Minor scrape on deck', peopleInvolved: 'Swimmer, age 9', actionsTaken: 'Cleaned and bandaged', emsCalled: false },
    });
    expect(created.status).toBe(201);
    await call(sup).get(`/api/incidents/${created.body.id}?purpose=Monthly%20safety%20review`);
    const list = await call(sup).get(`/api/incidents?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`);
    expect(list.body[0]).toMatchObject({ category: 'FIRST_AID', timesOpened: 1 });
    expect(JSON.stringify(list.body)).not.toContain('scrape');
  });

  it('pool details: capacity, depth and retiring a pool', async () => {
    expect((await call(sup).patch(`/api/ops/pools/${poolId}`, { maxCapacity: 150, depthMinM: '1.10', depthMaxM: '3.80', volumeLitres: 1200000, notes: '25 m, 6 lanes' })).status).toBe(200);
    expect((await call(sup).patch(`/api/ops/pools/${poolId}`, { depthMinM: '4.00' })).status).toBe(400);
    expect((await call(staff).patch(`/api/ops/pools/${poolId}`, { maxCapacity: 999 })).status).toBe(403);
    const lead = await call(head).get('/api/ops/pools');
    expect(lead.body[0]).toMatchObject({ maxCapacity: 150, depthMinM: '1.1', depthMaxM: '3.8', volumeLitres: 1200000, archived: false });
  });

  it('headcounts are their own record; going over capacity alerts the leads', async () => {
    const board = await call(staff).get('/api/ops/headcounts/current');
    expect(board.body[0]).toMatchObject({ id: poolId, maxCapacity: 150, last: null });
    const ok = await call(staff).post('/api/ops/headcounts', { poolBodyId: poolId, count: 80 });
    expect(ok.body).toMatchObject({ overCapacity: false, lifeguardsRequired: 2 });
    const over = await call(staff).post('/api/ops/headcounts', { poolBodyId: poolId, count: 160 });
    expect(over.body.overCapacity).toBe(true);
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id, type: 'over_capacity' } })).toBeGreaterThan(0);
    // The status board follows the latest count, not old chemistry entries.
    expect((await call(head).get('/api/ops/pools')).body[0]).toMatchObject({ lifeguardsRequired: 4, lastHeadcount: { count: 160, overCapacity: true } });
    const report = await call(staff).get(`/api/ops/headcounts?from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`);
    expect(report.body.map((r: { count: number }) => r.count)).toEqual([160, 80]);
  });

  it('a retired pool leaves the clicker but keeps its history', async () => {
    await call(sup).patch(`/api/ops/pools/${poolId}`, { archived: true });
    expect((await call(staff).get('/api/ops/headcounts/current')).body).toEqual([]);
    expect((await call(staff).post('/api/ops/headcounts', { poolBodyId: poolId, count: 5 })).status).toBe(404);
    await call(sup).patch(`/api/ops/pools/${poolId}`, { archived: false });
  });
});

