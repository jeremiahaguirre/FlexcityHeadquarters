/**
 * Deck facility scope (ASVS 8.2.2, 1.5.3, 2.2.3, 15.3.7): a lead whose role is limited to one pool
 * runs that pool's deck and no other, whichever source (query or body) names the facility, and a
 * station's pool belongs to the station's facility.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'deckscope';
let t: Awaited<ReturnType<typeof seedTenant>>;
let lead: string; // limited to the Rec Centre (facility A)
let sup: string; // AQUATIC_SUPERVISOR, the whole organization
let A: string;
let B: string;
let stationA: string;
let stationB: string;
let poolA: string;
let poolB: string;
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return {
    get: (p: string) => w(request(server).get(p)),
    post: (p: string, b: object = {}) => w(request(server).post(p)).send(b),
    patch: (p: string, b: object) => w(request(server).patch(p)).send(b),
  };
};
const openLogsAt = (facilityId: string) => owner.rotationLog.count({ where: { facilityId, endedAt: null } });

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 2);
  A = t.facility.id;
  B = (await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Outdoor Pool', province: 'BC', timezone: 'America/Vancouver', latitude: 49.9, longitude: -119.4 } })).id;
  poolA = (await owner.poolBody.create({ data: { tenantId: t.tenant.id, facilityId: A, name: 'Main tank', kind: 'POOL' } })).id;
  poolB = (await owner.poolBody.create({ data: { tenantId: t.tenant.id, facilityId: B, name: 'Outdoor tank', kind: 'POOL' } })).id;
  stationA = (await owner.deckStation.create({ data: { tenantId: t.tenant.id, facilityId: A, name: 'Chair A' } })).id;
  stationB = (await owner.deckStation.create({ data: { tenantId: t.tenant.id, facilityId: B, name: 'Chair B' } })).id;
  // A deck lead limited to facility A (schedule.write makes the facility limit apply).
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Rec Centre deck lead', permissions: ['deck.rotate', 'ops.configure', 'schedule.write'], scopeFacilityIds: [A] } });
  const l = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'FULL_TIME', firstName: 'Deck', lastName: 'Lead', email: `lead@${SUB}.test` } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: l.id, customRoleId: role.id } });
  forgetCustomPermissions(t.tenant.id);
  lead = await signAccessToken({ sub: l.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: 'Whole', email: `sup@${SUB}.test` } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
  // Someone on deck at B, so closing or rotating B would show.
  await owner.rotationLog.create({ data: { tenantId: t.tenant.id, facilityId: B, stationId: stationB, userId: t.users[1]!.id, startedAt: new Date(Date.now() - 10 * 60_000), recordedById: s.id } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('a facility-limited deck lead at their own pool', () => {
  it('reads, creates and edits stations, rotates and closes the deck', async () => {
    expect((await call(lead).get(`/api/deck/stations?facilityId=${A}`)).status).toBe(200);
    expect((await call(lead).get(`/api/deck/plan?facilityId=${A}`)).status).toBe(200);
    const created = await call(lead).post('/api/deck/stations', { facilityId: A, name: 'Slide', poolBodyId: poolA });
    expect(created.status).toBe(201);
    expect((await call(lead).patch(`/api/deck/stations/${stationA}`, { name: 'Chair A1', poolBodyId: poolA })).status).toBe(200);
    expect((await call(lead).post('/api/deck/rotate', { facilityId: A, assignments: [{ stationId: stationA, userId: t.users[0]!.id }] })).status).toBe(200);
    expect(await openLogsAt(A)).toBe(1);
    expect((await call(lead).post('/api/deck/close', { facilityId: A })).status).toBe(200);
    expect(await openLogsAt(A)).toBe(0);
  });
});

describe('another pool, whichever parameter names it', () => {
  it('reading another facility’s deck is not found', async () => {
    for (const p of [`/api/deck/stations?facilityId=${B}`, `/api/deck/plan?facilityId=${B}`, `/api/deck/log?facilityId=${B}&from=2026-01-01&to=2027-01-01`]) {
      expect((await call(lead).get(p)).status, p).toBe(404);
    }
  });

  it('rotate with its own facility in the query and another in the body is not found and changes nothing', async () => {
    const r = await call(lead).post(`/api/deck/rotate?facilityId=${A}`, { facilityId: B, assignments: [{ stationId: stationB, userId: t.users[0]!.id }] });
    expect(r.status).toBe(404);
    const open = await owner.rotationLog.findMany({ where: { facilityId: B, endedAt: null } });
    expect(open.map((o) => o.userId)).toEqual([t.users[1]!.id]);
  });

  it('close with its own facility in the query and another in the body is not found and changes nothing', async () => {
    const r = await call(lead).post(`/api/deck/close?facilityId=${A}`, { facilityId: B });
    expect(r.status).toBe(404);
    expect(await openLogsAt(B)).toBe(1);
  });

  it('creating a station with its own facility in the query and another in the body is not found', async () => {
    const r = await call(lead).post(`/api/deck/stations?facilityId=${A}`, { facilityId: B, name: 'Sneaky chair' });
    expect(r.status).toBe(404);
    expect(await owner.deckStation.count({ where: { facilityId: B, name: 'Sneaky chair' } })).toBe(0);
  });

  it('editing or archiving another facility’s station is not found and changes nothing', async () => {
    expect((await call(lead).patch(`/api/deck/stations/${stationB}`, { name: 'Renamed' })).status).toBe(404);
    expect((await call(lead).patch(`/api/deck/stations/${stationB}?facilityId=${A}`, { archived: true })).status).toBe(404);
    const s = await owner.deckStation.findUniqueOrThrow({ where: { id: stationB } });
    expect(s.name).toBe('Chair B');
    expect(s.archivedAt).toBeNull();
  });

  it('a repeated facilityId in the query is refused, for everyone', async () => {
    for (const token of [lead, sup]) {
      const r = await call(token).get(`/api/deck/plan?facilityId=${A}&facilityId=${B}`);
      expect(r.status).toBe(400);
    }
    expect((await call(lead).post(`/api/deck/close?facilityId=${A}&facilityId=${B}`, { facilityId: A })).status).toBe(400);
  });
});

describe('a station’s pool', () => {
  it('a pool at another facility is refused when creating or editing a station', async () => {
    const r = await call(sup).post('/api/deck/stations', { facilityId: A, name: 'Wrong pool', poolBodyId: poolB });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('POOL_BODY_UNKNOWN');
    const p = await call(sup).patch(`/api/deck/stations/${stationA}`, { poolBodyId: poolB });
    expect(p.status).toBe(400);
    expect(p.body.code).toBe('POOL_BODY_UNKNOWN');
    expect((await owner.deckStation.findUniqueOrThrow({ where: { id: stationA } })).poolBodyId).toBe(poolA);
    const unknown = await call(sup).post('/api/deck/stations', { facilityId: A, name: 'No such pool', poolBodyId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(400);
  });
});

describe('a lead for the whole organization', () => {
  it('still rotates, edits and closes any pool', async () => {
    expect((await call(sup).patch(`/api/deck/stations/${stationB}`, { poolBodyId: poolB })).status).toBe(200);
    expect((await call(sup).post('/api/deck/rotate', { facilityId: B, assignments: [{ stationId: stationB, userId: t.users[0]!.id }] })).status).toBe(200);
    expect((await call(sup).post('/api/deck/close', { facilityId: B })).status).toBe(200);
    expect(await openLogsAt(B)).toBe(0);
  });
});
