import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { rotationAlerts } from '../../src/services/jobs/daily.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'deckrot';
let t: Awaited<ReturnType<typeof seedTenant>>;
let head: string;
let guard: string;
let headId: string;
const ids: string[] = [];
const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b), patch: (p: string, b: object) => w(request(server).patch(p)).send(b) };
};

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 3);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HEAD_LIFEGUARD'], employmentStatus: 'FULL_TIME', firstName: 'Hal', lastName: 'Head', email: 'head@deckrot.test' } });
  headId = h.id;
  const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sue', lastName: 'Sup', email: 'sup@deckrot.test' } });
  head = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HEAD_LIFEGUARD'] });
  guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  const supTok = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  for (const [i, name] of ['Deep end chair', 'Shallow chair'].entries()) {
    const r = await call(supTok).post('/api/deck/stations', { facilityId: t.facility.id, name, sortOrder: i });
    expect(r.status).toBe(201);
    ids.push(r.body.id);
  }
  // Everyone on duty, including the head guard.
  for (const u of [...t.users.map((x) => x.id), headId]) {
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u, facilityId: t.facility.id, positionId: t.position.id, clockIn: new Date(Date.now() - 3 * 3_600_000) } });
  }
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('deck rotation', () => {
  it('only head guards and supervisors run the rotation; staff cannot manage stations', async () => {
    expect((await call(guard).get(`/api/deck/plan?facilityId=${t.facility.id}`)).status).toBe(403);
    expect((await call(head).post('/api/deck/stations', { facilityId: t.facility.id, name: 'Slide' })).status).toBe(403);
  });

  it('suggests a first rotation from who is on duty and applies it', async () => {
    const plan = await call(head).get(`/api/deck/plan?facilityId=${t.facility.id}`);
    expect(plan.body.stations).toHaveLength(2);
    expect(plan.body.onDuty).toHaveLength(4);
    const assignments = plan.body.suggestion.assignments.map((a: { stationId: string; userId: string }) => ({ stationId: a.stationId, userId: a.userId }));
    expect(assignments.every((a: { userId: string | null }) => a.userId)).toBe(true);
    expect((await call(head).post('/api/deck/rotate', { facilityId: t.facility.id, assignments })).status).toBe(200);
    const after = await call(head).get(`/api/deck/plan?facilityId=${t.facility.id}`);
    expect(after.body.stations.every((s: { current: unknown }) => s.current)).toBe(true);
  });

  it('refuses one person on two stations', async () => {
    const u = t.users[0]!.id;
    const r = await call(head).post('/api/deck/rotate', { facilityId: t.facility.id, assignments: ids.map((stationId) => ({ stationId, userId: u })) });
    expect(r.status).toBe(400);
  });

  it('a guard sees their own station and when to move', async () => {
    const first = (await call(head).get(`/api/deck/plan?facilityId=${t.facility.id}`)).body.stations[0].current.userId;
    const tok = await signAccessToken({ sub: first, tid: t.tenant.id, roles: ['STAFF'] });
    const me = await call(tok).get('/api/me/deck');
    expect(me.body.station).toBe('Deep end chair');
    expect(new Date(me.body.dueAt).getTime() - new Date(me.body.startedAt).getTime()).toBe(30 * 60_000);
  });

  it('alerts on-duty leads and the guard once when a rotation is overdue, and logs every move', async () => {
    await owner.rotationLog.updateMany({ where: { facilityId: t.facility.id, endedAt: null, stationId: { not: null } }, data: { startedAt: new Date(Date.now() - 40 * 60_000) } });
    const run = () => withTenant(t.tenant.id, (tx) => rotationAlerts(tx), { prisma: appDb });
    expect(await run()).toBe(2);
    expect(await run()).toBe(0);
    expect(await owner.notification.count({ where: { userId: headId, type: 'rotation_overdue' } })).toBe(2);
    const plan = await call(head).get(`/api/deck/plan?facilityId=${t.facility.id}`);
    expect(plan.body.stations[0].current.overdue).toBe(true);
    // Rotate again: the log closes the old entries and the person leaving goes on break.
    const assignments = plan.body.suggestion.assignments.map((a: { stationId: string; userId: string }) => ({ stationId: a.stationId, userId: a.userId }));
    await call(head).post('/api/deck/rotate', { facilityId: t.facility.id, assignments });
    const log = await call(head).get(`/api/deck/log?facilityId=${t.facility.id}&from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`);
    expect(log.body.filter((l: { station: string | null }) => l.station === null).length).toBeGreaterThan(0);
    expect(log.body.filter((l: { endedAt: string | null }) => l.endedAt).length).toBe(2);
  });

  it('turns off with the rotations feature', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { rotations: false } } });
    const { forgetFeatures } = await import('../../src/services/platform/features.js');
    forgetFeatures();
    expect((await call(head).get(`/api/deck/plan?facilityId=${t.facility.id}`)).status).toBe(404);
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: {} } });
    forgetFeatures();
  });
});
