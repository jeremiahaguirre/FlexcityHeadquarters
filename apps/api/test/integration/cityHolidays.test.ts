/**
 * Holidays and closure days a city adds on top of the statutory ones (TenantHoliday): the settings
 * screen's API, BC holiday pay and the premium on a city-added holiday, closure days (no pay,
 * not counted as leave, skipped by rotations), the holiday lists (app and public API), and
 * isolation between cities.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { addDays, startOfLocalDay } from '../../src/lib/time.js';
import { runPayroll } from '../../src/services/payroll/payrollRun.js';
import { lieuAvailable } from '../../src/services/payroll/lieu.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { decideTimeOff, requestTimeOff } from '../../src/services/people/timeOff.js';
import { weekdayRecount } from '../../src/services/people/leaveHours.js';
import { exportSummary } from '../../src/services/platform/cityExport.js';
import { purgePlan, purgeTenant } from '../../src/services/platform/purge.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const A = 'cityhol';
const B = 'cityholb';
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
let hrId = '';
let hrB = '';
let guardTok = '';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = A) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, body: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  patch: (p: string, body: object = {}) => request(server).patch(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  put: (p: string, body: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
});

// A BC week in 2030 with no statutory holiday: Monday March 11 to Sunday March 17.
const PERIOD = '2030-03-11';
const CIVIC = '2030-03-12'; // Tuesday: the city's paid holiday
const CLOSED = '2030-03-14'; // Thursday: the city's closure day

/** 8 hours from 9 a.m. local on each date. */
async function work(t: typeof a, userId: string, dates: string[]) {
  for (const d of dates) {
    const start = new Date(startOfLocalDay(d, t.facility.timezone).getTime() + 9 * 3_600_000);
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
  }
}
/** Weekdays (Monday to Friday) in [from, to). */
function weekdays(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) if (![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) out.push(d);
  return out;
}
const payrollOf = (t: typeof a) => withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, PERIOD, 1));
const lines = (r: Awaited<ReturnType<typeof runPayroll>>, userId: string) => r.results.filter((x) => x.userId === userId).flatMap((x) => x.result.lines.map((l) => ({ code: l.code, hours: Number(l.hours), amount: Number(l.amount), multiplier: Number(l.multiplier) })));
const total = (ls: ReturnType<typeof lines>, code: string, k: 'hours' | 'amount' = 'amount') => Math.round(ls.filter((l) => l.code === code).reduce((s, l) => s + l[k], 0) * 100) / 100;

beforeAll(async () => {
  resetLimits();
  a = await seedTenant(A, 3);
  b = await seedTenant(B, 1);
  for (const t of [a, b]) {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
    for (const u of t.users) {
      await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
      await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 20, effectiveFrom: new Date('2025-01-01') } });
    }
  }
  hrId = (await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: `hr@${A}.test` } })).id;
  hr = await signAccessToken({ sub: hrId, tid: a.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  const hrBId = (await owner.user.create({ data: { tenantId: b.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'B', email: `hr@${B}.test` } })).id;
  hrB = await signAccessToken({ sub: hrBId, tid: b.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  guardTok = await signAccessToken({ sub: a.users[0]!.id, tid: a.tenant.id, roles: ['STAFF'], aat: now() });

  // Guard 0 works Monday to Friday for six weeks, the city's holiday included.
  // Guard 1 works the same weeks but takes the holiday and the closure day off (their usual working days).
  // Guard 2 works only the closure day in the period, after the same six weeks.
  const history = weekdays('2030-01-28', PERIOD);
  await work(a, a.users[0]!.id, [...history, ...weekdays(PERIOD, '2030-03-16')]);
  await work(a, a.users[1]!.id, [...history, '2030-03-11', '2030-03-13', '2030-03-15']);
  await work(a, a.users[2]!.id, [...history, CLOSED]);
  // The other city: same pattern as guard 0, and no city holidays of its own.
  await work(b, b.users[0]!.id, [...history, ...weekdays(PERIOD, '2030-03-16')]);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

let civicId = '';
let closedId = '';

describe('settings', () => {
  it('without a city holiday, the week is ordinary: no holiday pay, no premium (before)', async () => {
    const r = await payrollOf(a);
    expect(total(lines(r, a.users[0]!.id), 'STAT_HOLIDAY_PAY')).toBe(0);
    expect(total(lines(r, a.users[0]!.id), 'STAT_WORKED', 'hours')).toBe(0);
  });

  it('HR adds a paid holiday and a closure day with English and French names; each is audited', async () => {
    const c = await call(hr).post('/api/settings/city-holidays', { name: 'Civic Day', nameFr: 'Journée civique', kind: 'PAID', date: CIVIC, recurrence: 'NONE' });
    expect(c.status).toBe(201);
    civicId = c.body.id;
    const d = await call(hr).post('/api/settings/city-holidays', { name: 'Spring closure', nameFr: 'Fermeture du printemps', kind: 'CLOSURE', date: CLOSED, recurrence: 'NONE' });
    expect(d.status).toBe(201);
    closedId = d.body.id;
    const list = await call(hr).get('/api/settings/city-holidays');
    expect(list.status).toBe(200);
    expect(list.body.holidays.map((h: { name: string; nameFr: string; kind: string }) => [h.name, h.nameFr, h.kind])).toEqual([
      ['Civic Day', 'Journée civique', 'PAID'],
      ['Spring closure', 'Fermeture du printemps', 'CLOSURE'],
    ]);
    expect(await owner.auditLog.count({ where: { tenantId: a.tenant.id, action: 'cityholiday.create' } })).toBe(2);
  });

  it('a repeating rule shows its coming days; a bad rule is refused with its own code', async () => {
    const r = await call(hr).post('/api/settings/city-holidays', { name: 'Boxing Day', nameFr: 'Lendemain de Noël', kind: 'PAID', date: '2026-12-26', recurrence: 'YEARLY_DATE' });
    expect(r.status).toBe(201);
    const list = await call(hr).get('/api/settings/city-holidays');
    const boxing = list.body.holidays.find((h: { id: string }) => h.id === r.body.id);
    expect(boxing.next).toHaveLength(1);
    expect(boxing.next[0]).toMatch(/-12-26$/);
    expect((await call(hr).post('/api/settings/city-holidays', { name: 'Fifth Monday', nameFr: 'Cinquième lundi', kind: 'PAID', date: '2026-08-31', recurrence: 'YEARLY_NTH_WEEKDAY' })).body.code).toBe('NTH_WEEKDAY_FIFTH');
    expect((await call(hr).post('/api/settings/city-holidays', { name: 'Ends early', nameFr: 'Finit tôt', kind: 'PAID', date: '2027-01-02', recurrence: 'YEARLY_DATE', untilYear: 2026 })).body.code).toBe('UNTIL_BEFORE_START');
    expect((await call(hr).post('/api/settings/city-holidays', { name: 'No French', kind: 'PAID', date: '2027-01-02' })).status).toBe(400);
    const p = await call(hr).patch(`/api/settings/city-holidays/${r.body.id}`, { name: 'Boxing Day', nameFr: 'Lendemain de Noël', kind: 'CLOSURE', date: '2026-12-26', recurrence: 'YEARLY_DATE', untilYear: 2027 });
    expect(p.status).toBe(200);
    expect((await call(hr).del(`/api/settings/city-holidays/${r.body.id}`)).status).toBe(204);
    expect(await owner.tenantHoliday.count({ where: { tenantId: a.tenant.id } })).toBe(2);
  });

  it('only people who configure the organization can change them; another city sees none of them', async () => {
    expect((await call(guardTok).get('/api/settings/city-holidays')).status).toBe(403);
    expect((await call(guardTok).post('/api/settings/city-holidays', { name: 'X day', nameFr: 'Jour X', kind: 'PAID', date: CIVIC })).status).toBe(403);
    expect((await call(hrB, B).get('/api/settings/city-holidays')).body.holidays).toEqual([]);
    expect((await call(hrB, B).del(`/api/settings/city-holidays/${civicId}`)).status).toBe(404);
    expect((await call(hrB, B).patch(`/api/settings/city-holidays/${civicId}`, { name: 'Taken', nameFr: 'Pris', kind: 'CLOSURE', date: CIVIC })).status).toBe(404);
  });

  it('an administrator limited to some departments can’t read or change them: holidays change pay everywhere', async () => {
    const role = await owner.customRole.create({ data: { tenantId: a.tenant.id, name: 'Aquatics admin', permissions: ['tenant.configure', 'users.read'], scopePositionIds: [a.position.id] } });
    const scopedId = (await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'A', email: `scoped@${A}.test` } })).id;
    await owner.userCustomRole.create({ data: { tenantId: a.tenant.id, userId: scopedId, customRoleId: role.id } });
    forgetCustomPermissions(a.tenant.id);
    const scoped = await signAccessToken({ sub: scopedId, tid: a.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
    expect((await call(scoped).get('/api/settings')).status).toBe(200); // they do configure the organization…
    const body = { name: 'Scoped day', nameFr: 'Jour limité', kind: 'PAID', date: CIVIC };
    for (const r of [await call(scoped).get('/api/settings/city-holidays'), await call(scoped).post('/api/settings/city-holidays', body), await call(scoped).patch(`/api/settings/city-holidays/${civicId}`, body), await call(scoped).del(`/api/settings/city-holidays/${civicId}`)]) {
      expect(r.status).toBe(403); // …but not holidays
    }
    expect(await owner.tenantHoliday.count({ where: { tenantId: a.tenant.id } })).toBe(2);
  });
});

describe('BC payroll on a city-added holiday', () => {
  it('pays an average day’s pay (BC 30-day formula) to everyone eligible, and time and a half for hours worked on it', async () => {
    const r = await payrollOf(a);
    const worked = lines(r, a.users[0]!.id);
    // 15+ days worked in the 30 before, 8 hours a day at $20: an average day is $160.
    expect(total(worked, 'STAT_HOLIDAY_PAY')).toBe(160);
    expect(total(worked, 'STAT_WORKED', 'hours')).toBe(8);
    expect(worked.find((l) => l.code === 'STAT_WORKED')!.multiplier).toBe(1.5);
    // Took the holiday off on a day they usually work: holiday pay all the same.
    expect(total(lines(r, a.users[1]!.id), 'STAT_HOLIDAY_PAY')).toBe(160);
  });

  it('a closure day is a day off, but pays no holiday pay and no premium', async () => {
    const r = await payrollOf(a);
    const g2 = lines(r, a.users[2]!.id);
    expect(total(g2, 'STAT_WORKED', 'hours')).toBe(0);
    expect(total(g2, 'REGULAR', 'hours')).toBe(8);
    // Guard 2 didn't work the holiday but usually works Tuesdays (BC: holiday pay whatever the day).
    expect(total(g2, 'STAT_HOLIDAY_PAY')).toBe(160);
    // Guard 0 worked the closure day: ordinary hours.
    expect(total(lines(r, a.users[0]!.id), 'STAT_WORKED', 'hours')).toBe(8);
  });

  it('another city’s payroll is untouched', async () => {
    const r = await payrollOf(b);
    expect(total(lines(r, b.users[0]!.id), 'STAT_HOLIDAY_PAY')).toBe(0);
    expect(total(lines(r, b.users[0]!.id), 'STAT_WORKED', 'hours')).toBe(0);
  });
});

describe('leave and calendars', () => {
  it('a week of vacation with nothing scheduled doesn’t charge the city’s holiday or closure day', async () => {
    const tz = a.facility.timezone;
    const startsAt = startOfLocalDay(PERIOD, tz);
    const endsAt = startOfLocalDay('2030-03-16', tz);
    const charged = await withTenant(a.tenant.id, async (tx) => {
      const { request: req } = await requestTimeOff(tx, a.tenant.id, a.users[0]!.id, { type: 'VACATION', startsAt, endsAt });
      await decideTimeOff(tx, { userId: hrId, tenantId: a.tenant.id }, req.id, 'APPROVE');
      return tx.timeOffRequest.findUniqueOrThrow({ where: { id: req.id } });
    });
    expect(Number(charged.chargedHours)).toBe(24);
    expect(charged.chargedBasis).toBe('WEEKDAYS');
    // Payroll's recount report counts it the same way: nothing to review.
    expect((await withTenant(a.tenant.id, (tx) => weekdayRecount(tx), { readOnly: true })).map((r) => r.id)).not.toContain(charged.id);
  });

  it('the time-in-lieu bank counts a pending request the way approval will: without the holiday and the closure day', async () => {
    const tz = a.facility.timezone;
    const who = a.users[2]!.id;
    await owner.lieuAdjustment.create({ data: { tenantId: a.tenant.id, userId: who, hours: 40, note: 'Banked overtime', createdById: hrId } });
    // Monday to Friday, nothing scheduled: 40 weekday hours less the holiday (Tue) and the closure day (Thu).
    await owner.timeOffRequest.create({ data: { tenantId: a.tenant.id, userId: who, type: 'LIEU', status: 'PENDING', startsAt: startOfLocalDay(PERIOD, tz), endsAt: startOfLocalDay('2030-03-16', tz) } });
    expect(await withTenant(a.tenant.id, (tx) => lieuAvailable(tx, who))).toBe(40 - 24);
  });

  it('a pending request across New Year counts the same in both years’ balances (the closure day before it too)', async () => {
    const tz = a.facility.timezone;
    const who = a.users[1]!.id;
    const closure = await owner.tenantHoliday.create({ data: { tenantId: a.tenant.id, name: 'Year-end closure', nameFr: 'Fermeture de fin d’année', kind: 'CLOSURE', date: new Date('2030-12-27') } });
    await owner.timeOffRequest.create({ data: { tenantId: a.tenant.id, userId: who, type: 'VACATION', status: 'PENDING', startsAt: startOfLocalDay('2030-12-23', tz), endsAt: startOfLocalDay('2031-01-04', tz) } });
    const tok = await signAccessToken({ sub: who, tid: a.tenant.id, roles: ['STAFF'], aat: now() });
    const pending = async (year: number) => ((await call(tok).get(`/api/me/leave?year=${year}`)).body.types as Array<{ type: string; pending: number }>).find((x) => x.type === 'VACATION')!.pending;
    // Ten weekdays from Dec 23 to Jan 3, less the closure on Friday Dec 27.
    expect([await pending(2030), await pending(2031)]).toEqual([72, 72]);
    await owner.tenantHoliday.delete({ where: { id: closure.id } });
  });

  it('lists the city’s days with the statutory ones, for staff and through the public API', async () => {
    const mine = await call(guardTok).get(`/api/me/holidays?from=${PERIOD}`);
    const city = mine.body.holidays.filter((h: { source: string }) => h.source === 'CITY');
    expect(city.map((h: { date: string; nameFr: string; paid: boolean }) => [h.date, h.nameFr, h.paid])).toEqual([
      [CIVIC, 'Journée civique', true],
      [CLOSED, 'Fermeture du printemps', false],
    ]);
    const k = await call(hr).post('/api/integrations/api-keys', { name: 'Calendar', scopes: ['facilities:read'] });
    expect(k.status).toBe(201);
    const v1 = await request(server).get(`/api/v1/holidays?from=${PERIOD}&to=2030-03-18`).auth(k.body.key, { type: 'bearer' });
    expect(v1.status).toBe(200);
    expect(v1.body.data.map((h: { date: string; source: string; paid: boolean; name_fr: string }) => [h.date, h.source, h.paid, h.name_fr])).toEqual([
      [CIVIC, 'city', true, 'Journée civique'],
      [CLOSED, 'city', false, 'Fermeture du printemps'],
    ]);
    expect((await request(server).get('/api/v1/holidays?from=2030-03-18&to=2030-03-11').auth(k.body.key, { type: 'bearer' })).body.code).toBe('BAD_RANGE');
  });

  it('rotations skip the closure day at facilities closed on holidays', async () => {
    const dept = (await owner.department.create({ data: { tenantId: a.tenant.id, name: 'Aquatics', aquatic: true } })).id;
    await owner.position.update({ where: { id: a.position.id }, data: { departmentId: dept } });
    await owner.user.update({ where: { id: hrId }, data: { roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'] } });
    const sup = await signAccessToken({ sub: hrId, tid: a.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
    expect((await call(sup).put('/api/schedule/fill/settings', { departmentId: null, organization: { holidayClosedFacilityIds: [a.facility.id] } })).status).toBe(200);
    const c = await call(sup).post('/api/schedule/rotations', { name: 'Days', departmentId: dept, facilityId: a.facility.id, positionId: a.position.id, cycleDays: 1, anchorDate: PERIOD, pattern: [{ day: 0, start: '09:00', end: '17:00', label: 'day' }], crews: [{ name: 'A', offsetDays: 0, userIds: [] }] });
    expect(c.status).toBe(201);
    const dry = await call(sup).post('/api/schedule/rotations/generate', { templateIds: [c.body.id], from: PERIOD, to: '2030-03-16', dryRun: true });
    const status = Object.fromEntries((dry.body.items as Array<{ date: string; status: string }>).map((i) => [i.date, i.status]));
    expect(status[CIVIC]).toBe('holiday');
    expect(status[CLOSED]).toBe('holiday');
    expect(status['2030-03-13']).not.toBe('holiday');
  });
});

describe('the city’s own data', () => {
  it('row-level security: each city reads only its own', async () => {
    expect(await withTenant(b.tenant.id, (tx) => tx.tenantHoliday.count())).toBe(0);
    expect(await withTenant(a.tenant.id, (tx) => tx.tenantHoliday.findMany({ select: { id: true }, orderBy: { date: 'asc' } }))).toEqual([{ id: civicId }, { id: closedId }]);
  });

  it('is in the city data export, and the city purge deletes it', async () => {
    expect((await exportSummary(a.tenant.id)).tables).toContainEqual({ table: 'TenantHoliday', rows: 2 });
    expect((await purgePlan(owner, a.tenant.id)).counts).toContainEqual({ table: 'public.TenantHoliday', rows: 2 });
    await owner.tenant.update({ where: { id: b.tenant.id }, data: { offboardedAt: new Date(), deleteAfter: new Date(Date.now() - 1000) } });
    await owner.tenantHoliday.create({ data: { tenantId: b.tenant.id, name: 'Leaving day', nameFr: 'Jour du départ', date: new Date('2030-01-02') } });
    await purgeTenant(owner, b.tenant.id);
    expect(await owner.tenantHoliday.count({ where: { tenantId: b.tenant.id } })).toBe(0);
    expect(await owner.tenantHoliday.count({ where: { tenantId: a.tenant.id } })).toBe(2);
  });
});
