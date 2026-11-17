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

describe('punch corrections: payroll integrity', () => {
  const VAN_TZ = 'America/Vancouver';
  const local = (days: number, hhmm: string) => `${DateTime.now().setZone(VAN_TZ).plus({ days }).toISODate()}T${hhmm}`;
  const instant = (l: string) => DateTime.fromISO(l, { zone: VAN_TZ }).toJSDate();
  let sup2: string;
  let supId: string;
  let worker: { id: string };
  beforeAll(async () => {
    supId = (await owner.user.findFirstOrThrow({ where: { email: 'sup@theta.test' } })).id;
    const s2 = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Second', lastName: 'Sup', email: 'sup2@theta.test' } });
    sup2 = await signAccessToken({ sub: s2.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
    worker = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'PART_TIME', firstName: 'Pia', lastName: 'Payroll', email: 'pia@theta.test' } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: worker.id, positionId: t.position.id } });
  });
  const add = (token: string, inAt: string, outAt: string) => call(token).post('/api/punches', { userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, localClockIn: inAt, localClockOut: outAt, reason: 'Forgot to punch' });

  it('whoever adds or changes time can’t approve it; another supervisor can', async () => {
    const r = await add(sup, local(-5, '06:00'), local(-5, '14:00'));
    expect(r.status).toBe(201);
    const listed = (await call(sup).get('/api/punches')).body.find((p: { id: string }) => p.id === r.body.id);
    expect(listed.correctedByYou).toBe(true);
    const own = await call(sup).post('/api/punches/decision', { ids: [r.body.id], decision: 'APPROVE' });
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('OWN_CORRECTION');
    expect((await call(sup2).post('/api/punches/decision', { ids: [r.body.id], decision: 'APPROVE' })).status).toBe(200);
    // Approved, then padded by the same supervisor: back to review, and again not theirs to approve.
    expect((await call(sup).patch(`/api/punches/${r.body.id}`, { localClockOut: local(-5, '15:00'), reason: 'Stayed late' })).status).toBe(200);
    expect((await owner.timePunch.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('PENDING');
    expect((await call(sup).post('/api/punches/decision', { ids: [r.body.id], decision: 'APPROVE' })).body.code).toBe('OWN_CORRECTION');
  });

  it('time in an approved or paid pay period can’t be added or changed', async () => {
    const day = DateTime.now().setZone(VAN_TZ).minus({ days: 9 }).toISODate()!;
    const p = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: instant(`${day}T08:00`), clockOut: instant(`${day}T12:00`), status: 'APPROVED' } });
    const run = await owner.payRun.create({ data: { tenantId: t.tenant.id, periodStart: new Date(`${day}T00:00:00Z`), periodEnd: new Date(`${day}T00:00:00Z`), payDate: new Date(`${day}T00:00:00Z`), periodsPerYear: 26, status: 'PAID', preparedById: supId } });
    try {
      const edit = await call(sup2).patch(`/api/punches/${p.id}`, { localClockOut: `${day}T13:00`, reason: 'Stayed late' });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('PERIOD_PAID');
      const added = await add(sup2, `${day}T14:00`, `${day}T16:00`);
      expect(added.body.code).toBe('PERIOD_PAID');
      // A voided run doesn't lock the period.
      await owner.payRun.update({ where: { id: run.id }, data: { status: 'VOID' } });
      expect((await add(sup2, `${day}T14:00`, `${day}T16:00`)).status).toBe(201);
    } finally {
      await owner.payRun.update({ where: { id: run.id }, data: { status: 'VOID' } });
    }
  });

  it('the Approved view lists the last two weeks, newest first', async () => {
    const old = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: instant(local(-40, '08:00')), clockOut: instant(local(-40, '12:00')), status: 'APPROVED' } });
    const a = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: instant(local(-3, '08:00')), clockOut: instant(local(-3, '12:00')), status: 'APPROVED' } });
    const b = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: instant(local(-2, '08:00')), clockOut: instant(local(-2, '12:00')), status: 'APPROVED' } });
    const ids = (await call(sup).get('/api/punches?status=APPROVED')).body.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(old.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect((await call(sup).get(`/api/punches?status=APPROVED&from=${instant(local(-45, '00:00')).toISOString()}`)).body.map((x: { id: string }) => x.id)).toContain(old.id);
  });

  it('a rejected punch can be corrected back into review, or the right time added over it', async () => {
    const r = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: instant(local(-6, '08:00')), clockOut: instant(local(-6, '20:00')), status: 'REJECTED' } });
    expect((await add(sup, local(-6, '09:00'), local(-6, '13:00'))).status).toBe(201);
    const fixed = await call(sup).patch(`/api/punches/${r.id}`, { localClockOut: local(-6, '08:45'), reason: 'Wrong clock-out; corrected' });
    expect(fixed.status).toBe(200);
    expect((await owner.timePunch.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('PENDING');
  });

  it('a lead limited to one position can’t add or change time under another position', async () => {
    const arena = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Arena Attendant' } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: worker.id, positionId: arena.id } });
    const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Pool lead', permissions: ['timeclock.review', 'users.read'], scopePositionIds: [t.position.id] } });
    const leadUser = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Lena', lastName: 'Lead', email: 'lena@theta.test' } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: leadUser.id, customRoleId: role.id } });
    const lead = await signAccessToken({ sub: leadUser.id, tid: t.tenant.id, roles: ['EMPLOYEE'] });
    const asArena = await call(lead).post('/api/punches', { userId: worker.id, facilityId: t.facility.id, positionId: arena.id, localClockIn: local(-7, '08:00'), localClockOut: local(-7, '10:00'), reason: 'Rink shift' });
    expect(asArena.status).toBe(403);
    const arenaPunch = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: worker.id, facilityId: t.facility.id, positionId: arena.id, clockIn: instant(local(-8, '08:00')), clockOut: instant(local(-8, '10:00')) } });
    expect((await call(lead).patch(`/api/punches/${arenaPunch.id}`, { localClockOut: local(-8, '11:00'), reason: 'Stayed late' })).status).toBe(403);
    expect((await call(lead).post('/api/punches', { userId: worker.id, facilityId: t.facility.id, positionId: t.position.id, localClockIn: local(-7, '08:00'), localClockOut: local(-7, '10:00'), reason: 'Pool shift' })).status).toBe(201);
  });

  it('daylight saving: a skipped time is refused, a doubled time asks which one, an edit can’t stretch past 24 h', async () => {
    // Ontario still changes its clocks (British Columbia stays on daylight time from 2026).
    const toronto = await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Lakeshore Arena', province: 'ON', timezone: 'America/Toronto', latitude: 43.6, longitude: -79.4, costCenter: 'CC-ON' } });
    const addAt = (inAt: string, outAt: string) => call(sup).post('/api/punches', { userId: worker.id, facilityId: toronto.id, positionId: t.position.id, localClockIn: inAt, localClockOut: outAt, reason: 'Forgot to punch' });
    const skipped = await addAt('2026-03-08T02:30', '2026-03-08T05:00');
    expect(skipped.body).toMatchObject({ code: 'TIME_NOT_EXIST', details: { field: 'localClockIn' } });
    const twice = await addAt('2026-11-01T01:30', '2026-11-01T04:00');
    expect(twice.body).toMatchObject({ code: 'AMBIGUOUS_TIME', details: { field: 'localClockIn', offsets: ['-04:00', '-05:00'] } });
    const first = await addAt('2026-11-01T01:30-04:00', '2026-11-01T04:00');
    expect(first.status).toBe(201);
    const p = await owner.timePunch.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(p.clockIn.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    // 01:30 EDT to 04:00 EST is 3.5 hours, not 2.5.
    expect((p.clockOut!.getTime() - p.clockIn.getTime()) / 3_600_000).toBe(3.5);
    expect((await call(sup2).patch(`/api/punches/${p.id}`, { localClockOut: '2026-11-02T09:00', reason: 'typo' })).status).toBe(400);
  });
});
