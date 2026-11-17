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

describe('changing approved time off', () => {
  // In-app notices go through the event outbox (delivered after commit).
  const notices = async (type: string) => (await owner.eventOutbox.findMany({ where: { tenantId: t.tenant.id, type: 'notify' } })).flatMap((e) => (e.payload as { drafts: Array<{ userId: string; type: string; params: Record<string, unknown> }> }).drafts).filter((d) => d.type === type);
  const shiftFor = (userId: string, days: number) =>
    owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId, status: 'PUBLISHED', startsAt: at(days, 16), endsAt: at(days, 20) } });
  const newGuard = async (first: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'PART_TIME', firstName: first, lastName: 'theta', email: `${first.toLowerCase()}@theta.test` } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id } });
    return { id: u.id, token: await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['STAFF'] }) };
  };
  const supId = async () => (await owner.user.findFirstOrThrow({ where: { email: 'sup@theta.test' } })).id;

  it('cancelling approved leave gives back the shifts nobody took and tells the approver', async () => {
    const g = await newGuard('Cass');
    const open = await shiftFor(g.id, 40);
    const takenShift = await shiftFor(g.id, 41);
    const r = await call(g.token).post('/api/me/time-off', { type: 'VACATION', startsAt: at(40, 0), endsAt: at(42, 0) });
    expect((await call(sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' })).body.reopenedShifts).toBe(2);
    // A coworker picks up the second shift from the board.
    await owner.shift.update({ where: { id: takenShift.id }, data: { userId: guardId } });
    await owner.shiftOffer.updateMany({ where: { shiftId: takenShift.id, status: 'OPEN' }, data: { status: 'COMPLETED', claimedById: guardId } });

    const c = await call(g.token).post(`/api/me/time-off/${r.body.request.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'CANCELLED', restoredShifts: 1, takenShifts: 1 });
    expect((await owner.shift.findUniqueOrThrow({ where: { id: open.id } })).userId).toBe(g.id);
    expect(await owner.shiftOffer.count({ where: { shiftId: open.id, status: 'OPEN' } })).toBe(0);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: takenShift.id } })).userId).toBe(guardId);
    const told = (await notices('time_off_cancelled')).filter((d) => d.params.requestId === r.body.request.id);
    expect(told.map((d) => d.userId)).toContain(await supId());
    expect(told[0]!.params).toMatchObject({ restored: 1, taken: 1 });
  });

  it('a supervisor ends approved leave early: later shifts come back, the hours are measured again, the person is told', async () => {
    const g = await newGuard('Dana');
    const kept = await shiftFor(g.id, 51);
    const later = await shiftFor(g.id, 54);
    const r = await call(g.token).post('/api/me/time-off', { type: 'VACATION', startsAt: at(50, 0), endsAt: at(56, 0) });
    await call(sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' });
    expect(Number((await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.body.request.id } })).chargedHours)).toBe(8);

    expect((await call(g.token).post(`/api/time-off/${r.body.request.id}/revise`, { action: 'END_EARLY', endsAt: at(53, 0), reason: 'Back early' })).status).toBe(403);
    expect((await call(sup).post(`/api/time-off/${r.body.request.id}/revise`, { action: 'END_EARLY', endsAt: at(53, 0) })).status).toBe(400);
    expect((await call(sup).post(`/api/time-off/${r.body.request.id}/revise`, { action: 'END_EARLY', endsAt: at(57, 0), reason: 'Back early' })).body.code).toBe('BAD_END');
    const approved = await call(sup).get('/api/time-off?status=APPROVED');
    expect(approved.body.map((x: { id: string }) => x.id)).toContain(r.body.request.id);

    const v = await call(sup).post(`/api/time-off/${r.body.request.id}/revise`, { action: 'END_EARLY', endsAt: at(53, 0), reason: 'Back from holidays early' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'APPROVED', restoredShifts: 1 });
    const row = await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.body.request.id } });
    expect(row.endsAt.toISOString()).toBe(at(53, 0).toISOString());
    expect(Number(row.chargedHours)).toBe(4);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: later.id } })).userId).toBe(g.id);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: kept.id } })).userId).toBeNull();
    expect(await owner.auditLog.count({ where: { action: 'timeoff.end_early', entityId: row.id } })).toBe(1);
    expect((await notices('time_off_shortened')).some((d) => d.userId === g.id && d.params.reason === 'Back from holidays early')).toBe(true);
  });

  it('approved leave can be cancelled by a supervisor even once it has started, but never their own', async () => {
    const g = await newGuard('Eli');
    const started = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: g.id, type: 'VACATION', status: 'APPROVED', startsAt: at(-1, 0), endsAt: at(3, 0) } });
    expect((await call(g.token).post(`/api/me/time-off/${started.id}/cancel`)).body.code).toBe('ALREADY_STARTED');
    const v = await call(sup).post(`/api/time-off/${started.id}/revise`, { action: 'CANCEL', reason: 'Approved the wrong dates' });
    expect(v.body.status).toBe('CANCELLED');
    expect((await owner.timeOffRequest.findUniqueOrThrow({ where: { id: started.id } })).decisionNote).toBe('Approved the wrong dates');
    expect(await owner.auditLog.count({ where: { action: 'timeoff.revoke', entityId: started.id } })).toBe(1);
    expect((await notices('time_off_revoked')).some((d) => d.userId === g.id)).toBe(true);

    const mine = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: await supId(), type: 'VACATION', status: 'APPROVED', startsAt: at(60, 0), endsAt: at(61, 0) } });
    expect((await call(sup).post(`/api/time-off/${mine.id}/revise`, { action: 'CANCEL', reason: 'Not going' })).body.code).toBe('OWN_REQUEST');
  });

  it('a supervisor records a sick day after the fact (up to two weeks back); staff can enter their own past sick day', async () => {
    const g = await newGuard('Fay');
    const yesterday = await shiftFor(g.id, -1);
    expect((await call(staff).post(`/api/users/${g.id}/time-off`, { type: 'SICK', startsAt: at(-1, 0), endsAt: at(0, 0) })).status).toBe(403);
    const r = await call(sup).post(`/api/users/${g.id}/time-off`, { type: 'SICK', startsAt: at(-1, 0), endsAt: at(0, 0), note: 'Called in sick' });
    expect(r.status).toBe(201);
    const row = await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row).toMatchObject({ status: 'APPROVED', decidedById: await supId(), type: 'SICK' });
    // A past shift isn't posted to the board.
    expect((await owner.shift.findUniqueOrThrow({ where: { id: yesterday.id } })).userId).toBe(g.id);
    expect((await call(sup).post(`/api/users/${g.id}/time-off`, { type: 'SICK', startsAt: at(-20, 0), endsAt: at(-19, 0) })).body.code).toBe('TIME_OFF_TOO_OLD');

    const own = await call(g.token).post('/api/me/time-off', { type: 'SICK', startsAt: at(-3, 0), endsAt: at(-2, 0) });
    expect(own.status).toBe(201);
  });
});

describe('approved time off in a paid pay period', () => {
  it('can’t be cancelled or shortened there, and can’t be recorded there', async () => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'PART_TIME', firstName: 'Hal', lastName: 'theta', email: 'hal@theta.test' } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id } });
    const supId = (await owner.user.findFirstOrThrow({ where: { email: 'sup@theta.test' } })).id;
    const leave = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: u.id, type: 'VACATION', status: 'APPROVED', startsAt: at(-12, 8), endsAt: at(-10, 8) } });
    const day = at(-11, 20).toISOString().slice(0, 10);
    const run = await owner.payRun.create({ data: { tenantId: t.tenant.id, periodStart: new Date(`${day}T00:00:00Z`), periodEnd: new Date(`${day}T00:00:00Z`), payDate: new Date(`${day}T00:00:00Z`), periodsPerYear: 26, status: 'PAID', preparedById: supId } });
    try {
      const c = await call(sup).post(`/api/time-off/${leave.id}/revise`, { action: 'CANCEL', reason: 'Came back early' });
      expect(c.status).toBe(409);
      expect(c.body.code).toBe('PERIOD_PAID');
      const rec = await call(sup).post(`/api/users/${u.id}/time-off`, { type: 'SICK', startsAt: at(-11, 12), endsAt: at(-11, 20) });
      expect(rec.body.code).toBe('PERIOD_PAID');
      await owner.payRun.update({ where: { id: run.id }, data: { status: 'VOID' } });
      expect((await call(sup).post(`/api/time-off/${leave.id}/revise`, { action: 'CANCEL', reason: 'Came back early' })).status).toBe(200);
    } finally {
      await owner.payRun.update({ where: { id: run.id }, data: { status: 'VOID' } });
    }
  });
});
