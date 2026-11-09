import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
let t: Awaited<ReturnType<typeof seedTenant>>;
let supToken: string;
let staffToken: string;
let uncertifiedId: string;

const SUB = 'eta';
const day = (n: number, hour: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const sup = await owner.user.create({
    data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Okafor', email: 'sup@eta.test' },
  });
  const unc = await owner.user.create({
    data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Una', lastName: 'Certified', email: 'unc@eta.test', dateOfBirth: new Date('2001-01-01') },
  });
  await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: unc.id, positionId: t.position.id } });
  uncertifiedId = unc.id;
  supToken = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  staffToken = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('shift management', () => {
  let shiftId: string;
  let version: number;

  it('creates a draft shift with facility-local times', async () => {
    const r = await as(supToken).post('/api/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: day(10, 15), endsAt: day(10, 19) });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.localStartsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000-0[78]:00$/);
    shiftId = r.body.id;
    version = r.body.version;
  });

  it('rejects impossible times', async () => {
    const r = await as(supToken).post('/api/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: day(10, 19), endsAt: day(10, 15) });
    expect(r.status).toBe(400);
  });

  it('refuses to assign someone without the required certification', async () => {
    const r = await as(supToken).post(`/api/shifts/${shiftId}/assign`, { userId: uncertifiedId, expectedVersion: version });
    expect(r.status).toBe(422);
    expect(r.body.details.blocks.map((b: { code: string }) => b.code)).toContain('MISSING_CERTIFICATION');
  });

  it('ranks candidates: eligible first, blocked last', async () => {
    const r = await as(supToken).get(`/api/shifts/${shiftId}/candidates`);
    expect(r.status).toBe(200);
    const list = r.body.candidates as Array<{ user: { id: string }; eligible: boolean }>;
    expect(list[0]!.eligible).toBe(true);
    expect(list.at(-1)!.user.id).toBe(uncertifiedId);
  });

  it('assigns a qualified guard', async () => {
    const r = await as(supToken).post(`/api/shifts/${shiftId}/assign`, { userId: t.users[0]!.id, expectedVersion: version });
    expect(r.status).toBe(200);
    expect(r.body.shift.assignee.name).toBe('Guard0 eta');
    version = r.body.shift.version;
  });

  it('rejects a stale version', async () => {
    const r = await as(supToken).patch(`/api/shifts/${shiftId}`, { expectedVersion: version - 1, customTitle: 'x' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SHIFT_CHANGED');
  });

  it('requires an explicit acknowledgement before assigning overtime', async () => {
    const long = await as(supToken).post('/api/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: day(10, 15), endsAt: day(11, 0) }); // 8 a.m.–5 p.m. Vancouver: 9 h in one work day
    const first = await as(supToken).post(`/api/shifts/${long.body.id}/assign`, { userId: t.users[1]!.id, expectedVersion: long.body.version });
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ code: 'OVERTIME_REQUIRES_ACK', details: { overtimeHours: '1.00' } });
    const ack = await as(supToken).post(`/api/shifts/${long.body.id}/assign`, { userId: t.users[1]!.id, expectedVersion: long.body.version, acknowledgeOvertime: true });
    expect(ack.status).toBe(200);
    const log = await owner.auditLog.findFirstOrThrow({ where: { entityId: long.body.id, action: 'shift.assign' } });
    expect(log.after).toMatchObject({ overtimeAcknowledged: true, overtimeHours: '1' });
  });

  it('hides drafts from staff', async () => {
    const r = await as(staffToken).get(`/api/shifts?from=${day(9, 0)}&to=${day(12, 0)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(0);
  });

  it('publishes drafts, notifies assignees and posts open shifts to the board', async () => {
    const open = await as(supToken).post('/api/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: day(11, 15), endsAt: day(11, 19) });
    const r = await as(supToken).post('/api/shifts/publish', { facilityId: t.facility.id, from: day(9, 0), to: day(12, 0) });
    expect(r.body).toEqual({ published: 3, postedToBoard: 1 });
    expect(await owner.shiftOffer.count({ where: { shiftId: open.body.id, status: 'OPEN' } })).toBe(1);
  });

  it('shows staff the published schedule with coworkers abbreviated, and their own shifts', async () => {
    const all = await as(staffToken).get(`/api/shifts?from=${day(9, 0)}&to=${day(12, 0)}`);
    expect(all.body).toHaveLength(3);
    expect(all.body.find((s: { assignee: { name: string } | null }) => s.assignee?.name.startsWith('Guard1'))?.assignee.name).toBe('Guard1 e.');
    const mine = await as(staffToken).get(`/api/me/shifts?from=${day(9, 0)}&to=${day(12, 0)}`);
    expect(mine.body.map((s: { id: string }) => s.id)).toEqual([shiftId]);
  });

  it('cancels a shift and closes its board offers', async () => {
    const r = await as(supToken).post(`/api/shifts/${shiftId}/cancel`, { reason: 'Pool maintenance' });
    expect(r.status).toBe(200);
    const s = await owner.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(s.status).toBe('CANCELLED');
  });

  it('keeps staff out of management routes', async () => {
    const r = await as(staffToken).post('/api/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: day(10, 15), endsAt: day(10, 19) });
    expect(r.status).toBe(403);
  });
});
