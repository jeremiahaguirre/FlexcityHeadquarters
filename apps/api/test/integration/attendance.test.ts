import request from 'supertest';
import { DateTime } from 'luxon';
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
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
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

describe('punch corrections (supervisors fix and add time)', () => {
  // A facility-local wall-clock time `days` from today, as the date-time picker sends it.
  const local = (days: number, hhmm: string) => `${DateTime.now().setZone('America/Vancouver').plus({ days }).toISODate()}T${hhmm}`;
  const supId = async () => (await owner.user.findFirstOrThrow({ where: { email: 'sup@theta.test' } })).id;
  // In-app notices go through the event outbox (delivered after commit).
  const told = async (userId: string, type: string) => (await owner.eventOutbox.findMany({ where: { tenantId: t.tenant.id, type: 'notify' } })).some((e) => JSON.stringify(e.payload).includes(userId) && JSON.stringify(e.payload).includes(type));

  it('adds a punch someone forgot, in facility time, for review, with the reason kept', async () => {
    const other = t.users[1]!.id;
    const body = { userId: other, facilityId: t.facility.id, positionId: t.position.id, localClockIn: local(-1, '06:00'), localClockOut: local(-1, '10:30'), reason: 'Phone died; confirmed with the head guard' };
    expect((await call(staff).post('/api/punches', body)).status).toBe(403);
    const r = await call(sup).post('/api/punches', body);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    const p = await owner.timePunch.findUniqueOrThrow({ where: { id: r.body.id } });
    expect((p.clockOut!.getTime() - p.clockIn.getTime()) / 3_600_000).toBe(4.5);
    expect(DateTime.fromJSDate(p.clockIn, { zone: 'America/Vancouver' }).toFormat('HH:mm')).toBe('06:00');
    const edits = await owner.timePunchEdit.findMany({ where: { punchId: p.id } });
    expect(edits.map((e) => [e.field, e.oldValue, e.reason]).sort()).toEqual([
      ['clockIn', null, body.reason],
      ['clockOut', null, body.reason],
    ]);
    expect(await owner.auditLog.count({ where: { action: 'punch.add', entityId: p.id } })).toBe(1);
    expect(await told(other, 'punch_added')).toBe(true);
    // It is waiting in the review list like any other punch.
    expect((await call(sup).get('/api/punches')).body.map((x: { id: string }) => x.id)).toContain(p.id);

    // Overlapping time, the future, and their own time are refused.
    const overlap = await call(sup).post('/api/punches', { ...body, localClockIn: local(-1, '09:00'), localClockOut: local(-1, '12:00') });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('PUNCH_OVERLAPS');
    expect((await call(sup).post('/api/punches', { ...body, localClockIn: local(1, '06:00'), localClockOut: local(1, '08:00') })).body.code).toBe('PUNCH_IN_FUTURE');
    const own = await call(sup).post('/api/punches', { ...body, userId: await supId() });
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('OWN_PUNCH');
  });

  it('closes a punch someone forgot to clock out of, and tells them', async () => {
    const other = t.users[1]!.id;
    const open = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: other, facilityId: t.facility.id, positionId: t.position.id, clockIn: DateTime.fromISO(local(-2, '14:00'), { zone: 'America/Vancouver' }).toJSDate() } });
    const r = await call(sup).patch(`/api/punches/${open.id}`, { localClockOut: local(-2, '18:15'), reason: 'Forgot to clock out at close' });
    expect(r.status).toBe(200);
    const p = await owner.timePunch.findUniqueOrThrow({ where: { id: open.id } });
    expect(DateTime.fromJSDate(p.clockOut!, { zone: 'America/Vancouver' }).toFormat('HH:mm')).toBe('18:15');
    expect(await owner.timePunchEdit.count({ where: { punchId: open.id, field: 'clockOut', oldValue: null } })).toBe(1);
    expect(await told(other, 'punch_corrected')).toBe(true);
    const backwards = await call(sup).patch(`/api/punches/${open.id}`, { localClockOut: local(-2, '13:00'), reason: 'typo' });
    expect(backwards.body.code).toBe('PUNCH_OUT_BEFORE_IN');
  });

  it('a supervisor’s own punches and time off stay out of their queue, and deciding them says why', async () => {
    const me = await supId();
    const mine = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: me, facilityId: t.facility.id, positionId: t.position.id, clockIn: at(-4, 16), clockOut: at(-4, 20) } });
    const myLeave = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: me, type: 'VACATION', startsAt: at(30, 0), endsAt: at(31, 0) } });
    expect((await call(sup).get('/api/punches')).body.map((x: { id: string }) => x.id)).not.toContain(mine.id);
    expect((await call(sup).get('/api/time-off')).body.map((x: { id: string }) => x.id)).not.toContain(myLeave.id);
    const p = await call(sup).post('/api/punches/decision', { ids: [mine.id], decision: 'APPROVE' });
    expect(p.status).toBe(403);
    expect(p.body.code).toBe('OWN_PUNCH');
    const d = await call(sup).post(`/api/time-off/${myLeave.id}/decision`, { decision: 'APPROVE' });
    expect(d.status).toBe(403);
    expect(d.body.code).toBe('OWN_REQUEST');
  });
});
