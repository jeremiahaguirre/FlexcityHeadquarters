import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'theta';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
let staff: string;
let guardId: string;

const at = (days: number, hourUtc: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
};
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  guardId = t.users[0]!.id;
  const s = await owner.user.create({
    data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Sup', email: 'sup@theta.test' },
  });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  staff = await signAccessToken({ sub: guardId, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('availability', () => {
  it('replaces the weekly pattern from a date without rewriting history', async () => {
    const first = await call(staff).put('/api/me/availability', { effectiveFrom: '2026-01-01', windows: [{ dayOfWeek: 1, startMinute: 360, endMinute: 1080 }] });
    expect(first.status).toBe(200);
    const second = await call(staff).put('/api/me/availability', { effectiveFrom: '2026-12-01', windows: [{ dayOfWeek: 2, startMinute: 480, endMinute: 960 }] });
    expect(second.body).toHaveLength(1);
    const all = await owner.availability.findMany({ where: { userId: guardId }, orderBy: { effectiveFrom: 'asc' } });
    expect(all.map((w) => [w.dayOfWeek, w.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      [1, '2026-11-30'],
      [2, null],
    ]);
  });
});

describe('time off', () => {
  it('approving frees overlapping shifts and posts them to the board', async () => {
    const shift = await owner.shift.create({
      data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: guardId, status: 'PUBLISHED', startsAt: at(20, 16), endsAt: at(20, 20) },
    });
    const r = await call(staff).post('/api/me/time-off', { type: 'VACATION', startsAt: at(20, 0), endsAt: at(21, 0) });
    expect(r.status).toBe(201);
    expect(r.body.affectedShifts).toBe(1);

    const queue = await call(sup).get('/api/time-off');
    expect(queue.body[0]).toMatchObject({ id: r.body.request.id, affectedShifts: 1 });

    const d = await call(sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' });
    expect(d.body).toEqual({ status: 'APPROVED', reopenedShifts: 1 });
    const after = await owner.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(after.userId).toBeNull();
    expect(await owner.shiftOffer.count({ where: { shiftId: shift.id, status: 'OPEN' } })).toBe(1);
  });

  it('rejects overlapping requests', async () => {
    const r = await call(staff).post('/api/me/time-off', { type: 'OTHER', startsAt: at(20, 6), endsAt: at(20, 9) });
    expect(r.status).toBe(409);
  });

  it('requires a reason to decline statutory sick leave', async () => {
    const r = await call(staff).post('/api/me/time-off', { type: 'SICK', startsAt: at(30, 0), endsAt: at(31, 0) });
    const bare = await call(sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'DENY' });
    expect(bare.status).toBe(400);
    const withNote = await call(sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'DENY', note: 'Duplicate of an approved request' });
    expect(withNote.body.status).toBe('DENIED');
  });

  it('keeps staff out of the approval queue', async () => {
    expect((await call(staff).get('/api/time-off')).status).toBe(403);
  });
});

describe('punch review', () => {
  it('lists punches needing attention first and approves or rejects them', async () => {
    const shift = await owner.shift.create({
      data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: guardId, status: 'PUBLISHED', startsAt: at(-2, 16), endsAt: at(-2, 20) },
    });
    const onTime = await owner.timePunch.create({
      data: { tenantId: t.tenant.id, userId: guardId, facilityId: t.facility.id, shiftId: shift.id, positionId: t.position.id, clockIn: at(-2, 16), clockOut: at(-2, 20), locationStatus: 'VERIFIED' },
    });
    const late = await owner.timePunch.create({
      data: {
        tenantId: t.tenant.id, userId: guardId, facilityId: t.facility.id, positionId: t.position.id,
        clockIn: new Date(at(-3, 16).getTime() + 25 * 60_000), clockOut: at(-3, 20), locationStatus: 'OUTSIDE_RADIUS',
      },
    });
    const q = await call(sup).get('/api/punches');
    expect(q.body[0].id).toBe(late.id);
    expect(q.body[0].attention).toEqual(['UNSCHEDULED', 'OUTSIDE_GEOFENCE']);

    const noNote = await call(sup).post('/api/punches/decision', { ids: [late.id], decision: 'REJECT' });
    expect(noNote.status).toBe(400);
    const ok = await call(sup).post('/api/punches/decision', { ids: [onTime.id], decision: 'APPROVE' });
    expect(ok.body.updated).toBe(1);
    expect((await owner.timePunch.findUniqueOrThrow({ where: { id: onTime.id } })).status).toBe('APPROVED');
  });

  it('shows staff their own punches in facility time', async () => {
    const r = await call(staff).get(`/api/me/punches?from=${at(-5, 0).toISOString()}&to=${at(1, 0).toISOString()}`);
    expect(r.body.length).toBe(2);
    expect(r.body[0].localClockIn).toMatch(/-0[78]:00$/);
  });
});
