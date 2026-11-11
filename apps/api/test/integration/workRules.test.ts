/**
 * Scheduling wave 2, end to end: unpaid meal breaks, minimum call-in and call-back pay, shift
 * premium rules, late schedule changes and their premiums, standby pay, rotation templates (DST,
 * holidays, idempotent), two-person minimum (planner, publish, solver), on-call rosters with
 * call-outs, call-backs and working-alone escalation, and the settings screens' API.
 */
import request from 'supertest';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { runPayroll } from '../../src/services/payroll/payrollRun.js';
import { createCallOut } from '../../src/services/winter/callOuts.js';
import { loneWorkChecks } from '../../src/services/safety/loneWork.js';
import { dispatchTenant } from '../../src/lib/outbox.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'wrules';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});

const VAN = 'America/Vancouver';
const TOR = 'America/Toronto';
const local = (s: string, zone = VAN) => DateTime.fromFormat(s, 'yyyy-MM-dd HH:mm', { zone }).toJSDate();
const PERIOD = '2026-10-05'; // a Monday in the past: punches are approved

let t: Awaited<ReturnType<typeof seedTenant>>;
let dept = '';
let admin = '';
let tok = '';
let tokGuard = '';
let torFacility = '';
const g = () => t.users.map((u) => u.id);

/** Notifications sent through the outbox arrive just after the request. */
async function eventually(f: () => Promise<number>) {
  await dispatchTenant(t.tenant.id);
  return f();
}

const lines = (r: Awaited<ReturnType<typeof runPayroll>>, userId: string) => r.results.filter((x) => x.userId === userId).flatMap((x) => x.result.lines.map((l) => ({ code: l.code, hours: Number(l.hours), amount: Number(l.amount) })));
const sum = (ls: ReturnType<typeof lines>, code: string, k: 'hours' | 'amount' = 'hours') => Math.round(ls.filter((l) => l.code === code).reduce((s, l) => s + l[k], 0) * 100) / 100;

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  dept = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } })).id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: dept, unpaidBreakMinutes: 30 } });
  admin = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Ada', lastName: 'Admin', email: `admin@${SUB}.test` } })).id;
  tok = await signAccessToken({ sub: admin, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
  tokGuard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01'), employeeNumber: `E${u.id.slice(0, 4)}` } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    await owner.availability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tenantId: t.tenant.id, userId: u.id, dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: new Date('2020-01-01') })) });
  }
  torFacility = (await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Lakeshore Plant', province: 'ON', timezone: TOR } })).id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const shift = (data: { userId?: string | null; start: Date; end: Date; status?: 'DRAFT' | 'PUBLISHED'; callBack?: boolean; facilityId?: string; positionId?: string; unpaidBreakMinutes?: number | null }) =>
  owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: data.facilityId ?? t.facility.id, positionId: data.positionId ?? t.position.id, userId: data.userId ?? null, startsAt: data.start, endsAt: data.end, status: data.status ?? 'PUBLISHED', callBack: data.callBack ?? false, unpaidBreakMinutes: data.unpaidBreakMinutes } });
const punch = (userId: string, start: Date, end: Date, shiftId: string | null) => owner.timePunch.create({ data: { tenantId: t.tenant.id, userId, facilityId: t.facility.id, positionId: t.position.id, shiftId, clockIn: start, clockOut: end, status: 'APPROVED' } });

describe('payroll with work rules', () => {
  beforeAll(async () => {
    const [g0, g1, g2] = g();
    // g0: an 08:00–16:30 shift with the position's 30-minute lunch, one punch (lunch not punched).
    const a = await shift({ userId: g0, start: local('2026-10-05 08:00'), end: local('2026-10-05 16:30') });
    await punch(g0!, a.startsAt, a.endsAt, a.id);
    // g0: the same next day, lunch punched (two punches): paid as punched, nothing more taken off.
    const b = await shift({ userId: g0, start: local('2026-10-06 08:00'), end: local('2026-10-06 16:30') });
    await punch(g0!, local('2026-10-06 08:00'), local('2026-10-06 12:00'), b.id);
    await punch(g0!, local('2026-10-06 12:30'), local('2026-10-06 16:30'), b.id);
    // g1: scheduled 08:00–12:00 but sent home after an hour (BC minimum 2 h).
    const c = await shift({ userId: g1, start: local('2026-10-07 08:00'), end: local('2026-10-07 12:00'), unpaidBreakMinutes: 0 });
    await punch(g1!, local('2026-10-07 08:00'), local('2026-10-07 09:00'), c.id);
    // g1: a one-hour call-back (3 h call-back minimum by default).
    const d = await shift({ userId: g1, start: local('2026-10-08 20:00'), end: local('2026-10-08 21:00'), callBack: true });
    await punch(g1!, d.startsAt, d.endsAt, d.id);
    // g2: no shift (no planned break): paid as punched; plus Saturday morning for the weekend premium.
    await punch(g2!, local('2026-10-09 08:00'), local('2026-10-09 16:00'), null);
    await punch(g2!, local('2026-10-10 08:00'), local('2026-10-10 12:00'), null);
  });

  it('regression: with no work rules set, punches without shifts pay exactly as before', async () => {
    const r = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, PERIOD, 1));
    const l = lines(r, g()[2]!);
    expect(sum(l, 'REGULAR')).toBe(12);
    expect(sum(l, 'REGULAR', 'amount')).toBe(300);
    expect(sum(l, 'SHIFT_PREMIUM')).toBe(0);
    expect(l.map((x) => x.code).sort()).toEqual(['REGULAR', 'VACATION_PAY']);
  });

  it('unpaid breaks come out of a single punch, never out of a punched lunch; no daily overtime in BC', async () => {
    const r = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, PERIOD, 1));
    const l = lines(r, g()[0]!);
    expect(sum(l, 'REGULAR')).toBe(16);
    expect(sum(l, 'OVERTIME_1_5')).toBe(0);
  });

  it('minimum call-in pay and the call-back minimum top up short shifts', async () => {
    const r = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, PERIOD, 1));
    const l = lines(r, g()[1]!);
    expect(sum(l, 'REPORTING_PAY')).toBe(1); // worked 1 of BC’s 2 hours
    expect(sum(l, 'REPORTING_PAY', 'amount')).toBe(25);
    expect(sum(l, 'CALLBACK_PAY')).toBe(2); // worked 1 of 3
    expect(sum(l, 'CALLBACK_PAY', 'amount')).toBe(50);
  });

  it('a department’s higher call-in minimum and shift premium rules (weekend %, evening $/h)', async () => {
    const put = await call(tok).put('/api/schedule/work-rules', {
      premiums: [
        { id: 'wknd', name: 'Weekend', kind: 'weekend', days: [0, 6], startMinute: 0, endMinute: 1440, percent: 10 },
        { id: 'eve', name: 'Evening', kind: 'evening', startMinute: 1140, endMinute: 1440, perHour: 2, departmentIds: [dept] },
      ],
    });
    expect(put.status).toBe(200);
    expect((await call(tok).put(`/api/schedule/work-rules/departments/${dept}`, { callIn: { minHours: 3 } })).status).toBe(200);
    const r = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, PERIOD, 1));
    expect(sum(lines(r, g()[2]!), 'SHIFT_PREMIUM', 'amount')).toBe(10); // 4 h × 10% × $25
    const l1 = lines(r, g()[1]!);
    expect(sum(l1, 'REPORTING_PAY')).toBe(2); // the department’s 3 h now
    expect(sum(l1, 'SHIFT_PREMIUM', 'amount')).toBe(2); // the call-back 20:00–21:00 is evening
    await call(tok).put('/api/schedule/work-rules', { premiums: [] });
    await call(tok).put(`/api/schedule/work-rules/departments/${dept}`, { reset: true });
  });

  it('standby pay for on-call days in the period', async () => {
    await call(tok).put('/api/schedule/work-rules', { standby: { perDay: 40 } });
    const o = await call(tok).post('/api/schedule/on-call', { departmentId: dept, userId: g()[2], startsAt: local('2026-10-08 08:00'), endsAt: local('2026-10-10 08:00') });
    expect(o.status).toBe(201);
    const r = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, PERIOD, 1));
    expect(sum(lines(r, g()[2]!), 'STANDBY_PAY', 'amount')).toBe(80);
    await call(tok).put('/api/schedule/work-rules', { standby: { perDay: null } });
    await call(tok).del(`/api/schedule/on-call/${o.body.id}`);
  });
});

describe('schedule change notice', () => {
  let sid = '';
  const tomorrow = DateTime.now().setZone(VAN).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  beforeAll(async () => {
    await call(tok).put('/api/schedule/work-rules', { notice: { lateChangeHours: 72, premiumKind: 'multiplier', multiplier: 1.5 } });
    sid = (await shift({ userId: g()[0], start: tomorrow.toJSDate(), end: tomorrow.plus({ hours: 4 }).toJSDate(), unpaidBreakMinutes: 0 })).id;
  });

  it('warns before saving a late change, records the premium and tells the person', async () => {
    const newStart = tomorrow.minus({ hours: 2 }).toJSDate();
    const pre = await call(tok).post(`/api/shifts/${sid}/change-preview`, { startsAt: newStart });
    expect(pre.status).toBe(200);
    expect(pre.body.late).toBe(true);
    expect(pre.body.effects[0]).toMatchObject({ kind: 'TIME', late: true, premiumHours: 2, multiplier: 1.5 });
    const s = await owner.shift.findUniqueOrThrow({ where: { id: sid } });
    expect((await call(tok).patch(`/api/shifts/${sid}`, { startsAt: newStart, expectedVersion: s.version })).status).toBe(200);
    const rows = await owner.shiftChange.findMany({ where: { shiftId: sid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'TIME', late: true });
    expect(Number(rows[0]!.premiumHours)).toBe(2);
    expect(await eventually(() => owner.notification.count({ where: { userId: g()[0], type: 'schedule_late_change' } }))).toBe(1);
  });

  it('the premium is paid in the period of the shift, and a waived one isn’t', async () => {
    const week = DateTime.fromJSDate(tomorrow.toJSDate()).setZone(VAN).startOf('week').toISODate()!;
    const r = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, week, 1));
    expect(sum(lines(r, g()[0]!), 'SCHEDULE_CHANGE_PREMIUM', 'amount')).toBe(25); // 2 h × $25 × 0.5
    const list = await call(tok).get(`/api/schedule/changes?from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 3_600_000).toISOString()}`);
    expect(list.body).toHaveLength(1);
    expect((await call(tok).post(`/api/schedule/changes/${list.body[0].id}/waive`, { reason: 'Asked for by the employee' })).status).toBe(200);
    const r2 = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, week, 1));
    expect(sum(lines(r2, g()[0]!), 'SCHEDULE_CHANGE_PREMIUM', 'amount')).toBe(0);
  });

  it('reassigning late: the person added gets the whole shift as changed hours; drafts never count', async () => {
    const s = await owner.shift.findUniqueOrThrow({ where: { id: sid } });
    const r = await call(tok).post(`/api/shifts/${sid}/assign`, { userId: g()[1], expectedVersion: s.version, acknowledgeOvertime: true });
    expect(r.status).toBe(200);
    const rows = await owner.shiftChange.findMany({ where: { shiftId: sid }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((x) => x.kind)).toEqual(['TIME', 'REMOVED', 'ADDED']);
    expect(Number(rows[2]!.premiumHours)).toBe(6);
    const draft = await shift({ userId: g()[2], start: tomorrow.plus({ hours: 8 }).toJSDate(), end: tomorrow.plus({ hours: 10 }).toJSDate(), status: 'DRAFT' });
    await call(tok).patch(`/api/shifts/${draft.id}`, { startsAt: tomorrow.plus({ hours: 7 }).toJSDate(), expectedVersion: 0 });
    expect(await owner.shiftChange.count({ where: { shiftId: draft.id } })).toBe(0);
    await call(tok).put('/api/schedule/work-rules', { notice: { lateChangeHours: null } });
  });
});

describe('a shift changed twice (no double premium)', () => {
  const day = DateTime.now().setZone(VAN).plus({ days: 2 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  let sid = '';
  const patch = async (start: DateTime, end: DateTime) => {
    const s = await owner.shift.findUniqueOrThrow({ where: { id: sid } });
    expect((await call(tok).patch(`/api/shifts/${sid}`, { startsAt: start.toJSDate(), endsAt: end.toJSDate(), expectedVersion: s.version })).status).toBe(200);
  };
  const active = async () => (await owner.shiftChange.findMany({ where: { shiftId: sid, waivedAt: null, late: true } })).reduce((a, c) => a + Number(c.premiumHours ?? 0), 0);
  beforeAll(async () => {
    await call(tok).put('/api/schedule/work-rules', { notice: { lateChangeHours: 72, premiumKind: 'multiplier', multiplier: 1.5 } });
    sid = (await shift({ userId: g()[2], start: day.toJSDate(), end: day.plus({ hours: 8 }).toJSDate(), unpaidBreakMinutes: 0 })).id;
  });
  afterAll(async () => {
    await call(tok).put('/api/schedule/work-rules', { notice: { lateChangeHours: null } });
  });
  it('09–17 → 09–19 → 09–20: 3 changed hours in all (not 2 + 1 counted on top of each other twice); back to 09–17: none', async () => {
    await patch(day, day.plus({ hours: 10 }));
    expect(await active()).toBe(2);
    const pre = await call(tok).post(`/api/shifts/${sid}/change-preview`, { endsAt: day.plus({ hours: 11 }).toJSDate() });
    expect(pre.body.effects[0]).toMatchObject({ premiumHours: 3 });
    await patch(day, day.plus({ hours: 11 }));
    expect(await active()).toBe(3);
    await patch(day, day.plus({ hours: 8 }));
    expect(await active()).toBe(0);
    const list = await call(tok).get(`/api/schedule/changes?from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 3_600_000).toISOString()}`);
    expect(list.body.filter((c: { shiftId: string; superseded: boolean }) => c.shiftId === sid && c.superseded)).toHaveLength(2);
    expect(await owner.auditLog.count({ where: { action: 'shift.late_change.superseded', entityId: sid } })).toBe(2);
  });
  it('moved 09–17 → 13–21 → 15–23: 6 h outside the original times, paid once', async () => {
    await patch(day.plus({ hours: 4 }), day.plus({ hours: 12 }));
    expect(await active()).toBe(4);
    await patch(day.plus({ hours: 6 }), day.plus({ hours: 14 }));
    expect(await active()).toBe(6);
  });
  it('taken off the shift late: the earlier premiums go (they won’t work those hours)', async () => {
    const s = await owner.shift.findUniqueOrThrow({ where: { id: sid } });
    expect((await call(tok).post(`/api/shifts/${sid}/assign`, { userId: null, expectedVersion: s.version })).status).toBe(200);
    expect(await active()).toBe(0);
  });
  it('a supervisor of another department can’t waive a premium on this one', async () => {
    const other = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks' } })).id;
    const parksPos = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks worker', departmentId: other } })).id;
    const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Parks payroll', permissions: ['schedule.read', 'schedule.write', 'users.read', 'payroll.export'], scopePositionIds: [parksPos] } });
    const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Pat', lastName: 'Parks', email: `parks@${SUB}.test` } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: sup.id, customRoleId: role.id } });
    const tokParks = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now() });
    const c = await owner.shiftChange.create({ data: { tenantId: t.tenant.id, shiftId: sid, userId: g()[2]!, positionId: t.position.id, kind: 'TIME', noticeHours: 1, late: true, premiumHours: 1, multiplier: 1.5, payOn: new Date('2030-01-01'), changedById: admin } });
    expect((await call(tokParks).post(`/api/schedule/changes/${c.id}/waive`, { reason: 'Not mine' })).status).toBe(404);
    expect((await owner.shiftChange.findUniqueOrThrow({ where: { id: c.id } })).waivedAt).toBeNull();
    await owner.shiftChange.delete({ where: { id: c.id } });
  });
});

describe('two-person minimum', () => {
  let alone = '';
  const day = DateTime.now().setZone(VAN).plus({ days: 5 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  beforeAll(async () => {
    await owner.position.update({ where: { id: t.position.id }, data: { neverAlone: true } });
    alone = (await shift({ userId: g()[2], start: day.toJSDate(), end: day.plus({ hours: 4 }).toJSDate(), status: 'DRAFT', unpaidBreakMinutes: 0 })).id;
  });
  afterAll(async () => {
    await owner.position.update({ where: { id: t.position.id }, data: { neverAlone: false } });
  });

  it('the planner flags a never-alone shift with nobody else qualified on site', async () => {
    const from = day.toISODate()!;
    const r = await call(tok).get(`/api/schedule/planner?departmentId=${dept}&from=${from}&to=${day.plus({ days: 1 }).toISODate()}`);
    expect(r.status).toBe(200);
    const s = r.body.shifts.find((x: { id: string }) => x.id === alone);
    expect(s.neverAlone).toBe(true);
    expect(s.warnings).toContainEqual({ code: 'TWO_PERSON', n: [4] });
  });

  it('publish lists the violation and needs confirming; a second qualified person clears it', async () => {
    const body = { facilityId: t.facility.id, from: day.startOf('day').toJSDate(), to: day.endOf('day').toJSDate() };
    const check = await call(tok).post('/api/shifts/publish/check', body);
    expect(check.status).toBe(200);
    expect(check.body.twoPerson).toHaveLength(1);
    const pub = await call(tok).post('/api/shifts/publish', body);
    expect(pub.status).toBe(409);
    await shift({ userId: g()[1], start: day.toJSDate(), end: day.plus({ hours: 4 }).toJSDate(), status: "DRAFT", unpaidBreakMinutes: 0 });
    const again = await call(tok).post('/api/shifts/publish/check', body);
    expect(again.body.twoPerson).toHaveLength(0);
  });
});

describe('rotation templates', () => {
  let tpl = '';
  beforeAll(async () => {
    await owner.userPosition.createMany({ data: t.users.map((u) => ({ tenantId: t.tenant.id, userId: u.id, positionId: t.position.id })), skipDuplicates: true });
  });

  it('creates a 4-on-4-off template from the preset and generates drafts, placing crews only when the rules allow', async () => {
    const list = await call(tok).get('/api/schedule/rotations');
    const preset = list.body.presets.find((p: { key: string }) => p.key === 'FOUR_ON_FOUR_OFF');
    const anchor = DateTime.now().setZone(VAN).plus({ days: 20 }).toISODate()!;
    const crews = [{ ...preset.crews[0], userIds: [g()[0]] }, { ...preset.crews[1], userIds: [], openSlots: 1 }];
    const c = await call(tok).post('/api/schedule/rotations', { name: 'Plant 12s', departmentId: dept, facilityId: t.facility.id, positionId: t.position.id, cycleDays: preset.cycleDays, anchorDate: anchor, pattern: preset.pattern, crews, unpaidBreakMinutes: 30 });
    expect(c.status).toBe(201);
    tpl = c.body.id;
    const to = DateTime.fromISO(anchor).plus({ days: 8 }).toISODate()!;
    const dry = await call(tok).post('/api/schedule/rotations/generate', { templateIds: [tpl], from: anchor, to, dryRun: true });
    expect(dry.body.items).toHaveLength(8);
    expect(dry.body.created).toBe(0);
    const gen = await call(tok).post('/api/schedule/rotations/generate', { templateIds: [tpl], from: anchor, to });
    expect(gen.status).toBe(200);
    expect(gen.body.created).toBe(8);
    // Beyond the plan-ahead window (2 weeks) shifts stay open for Fill; crew B has open slots.
    expect(gen.body.items.filter((i: { status: string }) => i.status === 'open')).toHaveLength(8);
    const made = await owner.shift.findMany({ where: { rotationTemplateId: tpl } });
    expect(made.every((s) => s.status === 'DRAFT' && s.unpaidBreakMinutes === 30)).toBe(true);
    // Running it again makes nothing new.
    const again = await call(tok).post('/api/schedule/rotations/generate', { templateIds: [tpl], from: anchor, to });
    expect(again.body.created).toBe(0);
    expect(again.body.existing).toBe(8);
  });

  it('places the crew inside the plan-ahead window when they can work it', async () => {
    const anchor = DateTime.now().setZone(VAN).plus({ days: 2 }).toISODate()!;
    const c = await call(tok).post('/api/schedule/rotations', { name: 'Weekdays', departmentId: dept, facilityId: t.facility.id, positionId: t.position.id, cycleDays: 1, anchorDate: anchor, pattern: [{ day: 0, start: '06:00', end: '07:00' }], crews: [{ name: 'A', offsetDays: 0, userIds: [g()[0]] }] });
    const gen = await call(tok).post('/api/schedule/rotations/generate', { templateIds: [c.body.id], from: anchor, to: DateTime.fromISO(anchor).plus({ days: 2 }).toISODate() });
    expect(gen.body.assigned).toBe(2);
    await call(tok).del(`/api/schedule/rotations/${c.body.id}`);
  });

  it('DST: a 19:00–07:00 night on the spring-forward night is 11 real hours and still starts at 19:00', async () => {
    const c = await call(tok).post('/api/schedule/rotations', { name: 'Nights', departmentId: dept, facilityId: torFacility, positionId: t.position.id, cycleDays: 1, anchorDate: '2027-03-01', pattern: [{ day: 0, start: '19:00', end: '07:00', label: 'night' }], crews: [{ name: 'A', offsetDays: 0, userIds: [] }] });
    expect(c.status).toBe(201);
    const dry = await call(tok).post('/api/schedule/rotations/generate', { templateIds: [c.body.id], from: '2027-03-13', to: '2027-03-15', dryRun: true });
    const [sat, sun] = dry.body.items as Array<{ startsAt: string; endsAt: string }>;
    expect((Date.parse(sat!.endsAt) - Date.parse(sat!.startsAt)) / 3_600_000).toBe(11);
    expect((Date.parse(sun!.endsAt) - Date.parse(sun!.startsAt)) / 3_600_000).toBe(12);
    expect(DateTime.fromISO(sat!.startsAt).setZone(TOR).toFormat('HH:mm')).toBe('19:00');
  });

  it('skips statutory holidays at facilities the organization closes on them', async () => {
    await owner.statutoryHoliday.upsert({ where: { province_date: { province: 'BC', date: new Date('2026-12-25') } }, create: { province: 'BC', date: new Date('2026-12-25'), name: 'Christmas Day', key: 'CHRISTMAS' }, update: {} });
    const s = await call(tok).put('/api/schedule/fill/settings', { departmentId: null, organization: { holidayClosedFacilityIds: [t.facility.id] } });
    expect(s.status).toBe(200);
    const dry = await call(tok).post('/api/schedule/rotations/generate', { templateIds: [tpl], from: '2026-12-24', to: '2026-12-27', dryRun: true });
    const items = dry.body.items as Array<{ date: string; status: string }>;
    expect(items.filter((i) => i.date === '2026-12-25').every((i) => i.status === 'holiday')).toBe(true);
    expect(items.some((i) => i.date !== '2026-12-25' && i.status !== 'holiday')).toBe(true);
    await call(tok).put('/api/schedule/fill/settings', { departmentId: null, organization: { holidayClosedFacilityIds: [] } });
  });

  it('a staff member can’t see or make rotations', async () => {
    expect((await call(tokGuard).get('/api/schedule/rotations')).status).toBe(403);
  });
});

describe('on call', () => {
  const start = DateTime.now().setZone(VAN).plus({ days: 30 }).startOf('day').set({ hour: 8 });

  it('a weekly rotation, a swap, and the roster', async () => {
    const r = await call(tok).post('/api/schedule/on-call/rotate', { departmentId: dept, userIds: [g()[0], g()[1]], startDate: start.toISODate(), periods: 2 });
    expect(r.status).toBe(201);
    const roster = await call(tok).get(`/api/schedule/on-call?from=${start.toJSDate().toISOString()}&to=${start.plus({ days: 14 }).toJSDate().toISOString()}`);
    const periods = roster.body.periods as Array<{ id: string; userId: string }>;
    expect(periods.map((p) => p.userId)).toEqual([g()[0], g()[1]]);
    expect((await call(tok).post(`/api/schedule/on-call/${periods[0]!.id}/swap`, { withId: periods[1]!.id })).status).toBe(200);
    const after = await call(tok).get(`/api/schedule/on-call?from=${start.toJSDate().toISOString()}&to=${start.plus({ days: 14 }).toJSDate().toISOString()}`);
    expect(after.body.periods.map((p: { userId: string }) => p.userId)).toEqual([g()[1], g()[0]]);
    expect(await owner.notification.count({ where: { type: 'oncall_changed' } })).toBeGreaterThanOrEqual(2);
    const mine = await call(tokGuard).get('/api/me/on-call');
    expect(mine.body).toHaveLength(1);
  });

  it('winter call-outs ask the person on call first', async () => {
    const at = start.plus({ days: 2, hours: 10 });
    const c = await withTenant(t.tenant.id, (tx) => createCallOut(tx, { tenantId: t.tenant.id, userId: admin }, { facilityId: t.facility.id, positionId: t.position.id, reason: 'Main break', startsAt: at.toJSDate(), endsAt: at.plus({ hours: 2 }).toJSDate() }));
    const first = await owner.callOutContact.findFirstOrThrow({ where: { callOutId: c.id }, orderBy: { rank: 'asc' } });
    expect(first.userId).toBe(g()[1]); // on call that week after the swap
    expect((await owner.shift.findUniqueOrThrow({ where: { id: c.shiftId } })).callBack).toBe(true);
  });

  it('call-backs: the person on call by default, rest rules refuse unless it’s an emergency, and a short rest is flagged', async () => {
    const at = start.plus({ days: 3, hours: 14 });
    // g1 has a night shift 5 hours after the call-back would end (BC asks 8 h between shifts; not a split shift).
    await shift({ userId: g()[1], start: at.plus({ hours: 7 }).toJSDate(), end: at.plus({ hours: 15 }).toJSDate(), unpaidBreakMinutes: 0 });
    const body = { departmentId: dept, facilityId: t.facility.id, positionId: t.position.id, startsAt: at.toJSDate(), endsAt: at.plus({ hours: 2 }).toJSDate(), reason: 'Pump alarm' };
    const refused = await call(tok).post('/api/schedule/on-call/call-back', body);
    expect(refused.status).toBe(422);
    expect(refused.body.code ?? refused.body.error?.code).toBe('CALLBACK_REST');
    const ok = await call(tok).post('/api/schedule/on-call/call-back', { ...body, emergency: true });
    expect(ok.status).toBe(201);
    expect(ok.body.userId).toBe(g()[1]);
    expect(ok.body.nextShiftTooSoon).toBeTruthy();
    expect((await owner.shift.findUniqueOrThrow({ where: { id: ok.body.shiftId } })).callBack).toBe(true);
    expect(await owner.notification.count({ where: { type: 'callback_rest' } })).toBeGreaterThan(0);
    expect(await owner.notification.count({ where: { userId: g()[1], type: 'callback_requested' } })).toBe(1);
  });

  it('working-alone escalation alerts the person on call first', async () => {
    const nowOnCall = await call(tok).post('/api/schedule/on-call', { departmentId: dept, userId: g()[2], startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000) });
    expect(nowOnCall.status).toBe(201);
    await owner.loneWorkSession.create({ data: { tenantId: t.tenant.id, userId: g()[0]!, location: 'Reservoir', intervalMinutes: 30, nextDueAt: new Date(Date.now() - 60_000) } });
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    expect(await owner.notification.count({ where: { userId: g()[2], type: 'lonework_overdue' } })).toBe(1);
  });
});

describe('settings API', () => {
  it('shows the province’s meal break and call-in minimum, departments with their limits and federal switch', async () => {
    const r = await call(tok).get('/api/schedule/work-rules');
    expect(r.status).toBe(200);
    expect(r.body.provinces.find((p: { province: string }) => p.province === 'BC').reportingPay.minHours).toBe(2);
    expect(r.body.departments[0]).toMatchObject({ id: dept, effectiveFederal: false });
    expect(r.body.canConfigure).toBe(true);
    const pos = await call(tok).patch(`/api/schedule/work-rules/positions/${t.position.id}`, { unpaidBreakMinutes: 45 });
    expect(pos.body.unpaidBreakMinutes).toBe(45);
    expect((await call(tokGuard).put('/api/schedule/work-rules', { breaks: { warnMissing: false } })).status).toBe(403);
  });
});
