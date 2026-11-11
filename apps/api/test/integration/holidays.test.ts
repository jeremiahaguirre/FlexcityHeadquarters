/**
 * Statutory holidays that fall on a weekend: holiday pay per person on the observed day,
 * the organization's "observe on the next weekday" setting, and the forecast.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { addDays, startOfLocalDay } from '../../src/lib/time.js';
import { runPayroll } from '../../src/services/payroll/payrollRun.js';
import { seedStatHolidays } from '../../src/services/payroll/statHolidays.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
let qc: Awaited<ReturnType<typeof seedTenant>>;
let on: Awaited<ReturnType<typeof seedTenant>>;
let hrOn = '';
let supOn = '';
let supQc = '';
const now = () => Math.floor(Date.now() / 1000);

/** 8 hours from 9 a.m. local on each date. */
async function work(t: typeof qc, userId: string, dates: string[]) {
  for (const d of dates) {
    const start = new Date(startOfLocalDay(d, t.facility.timezone).getTime() + 9 * 3_600_000);
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
  }
}
/** Every date in [from, to) on the given weekdays. */
function days(from: string, to: string, weekdays: number[]) {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) if (weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) out.push(d);
  return out;
}
const lines = (r: Awaited<ReturnType<typeof runPayroll>>, userId: string) => r.results.find((x) => x.userId === userId)?.result.lines ?? [];
const hoursOf = (r: Awaited<ReturnType<typeof runPayroll>>, userId: string, code: string) => lines(r, userId).filter((l) => l.code === code).reduce((s, l) => s + Number(l.hours), 0);
const holidayPayLines = (r: Awaited<ReturnType<typeof runPayroll>>, userId: string) => lines(r, userId).filter((l) => l.code === 'STAT_HOLIDAY_PAY').length;
const call = (sub: string, token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  resetLimits();
  // Only years no other test file writes, so the shared table stays consistent.
  await seedStatHolidays(owner, [2027, 2029]);
  qc = await seedTenant('holqc', 2);
  on = await seedTenant('holon', 2);
  await owner.facility.update({ where: { id: qc.facility.id }, data: { province: 'QC', timezone: 'America/Toronto' } });
  await owner.facility.update({ where: { id: on.facility.id }, data: { province: 'ON', timezone: 'America/Toronto' } });
  for (const t of [qc, on]) {
    for (const u of t.users) {
      await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
      await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 20, effectiveFrom: new Date('2025-01-01') } });
    }
  }
  const mk = async (t: typeof qc, email: string, role: 'HR_ADMIN' | 'AQUATIC_SUPERVISOR') => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: [role], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email } })).id;
  hrOn = await signAccessToken({ sub: await mk(on, 'hr@holon.test', 'HR_ADMIN'), tid: on.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  supOn = await signAccessToken({ sub: await mk(on, 'sup@holon.test', 'AQUATIC_SUPERVISOR'), tid: on.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  supQc = await signAccessToken({ sub: await mk(qc, 'sup@holqc.test', 'AQUATIC_SUPERVISOR'), tid: qc.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });

  // Quebec, summer 2029: Canada Day is a Sunday (→ July 2 by law) and so is the Fête nationale (→ June 25 for people who don't work Sundays).
  // Weekday guard: Monday to Friday for ten weeks, then Monday July 2. Weekend guard: Saturday and Sunday, then Sunday July 1.
  const [wkday, wkend] = qc.users;
  await work(qc, wkday!.id, [...days('2029-04-15', '2029-07-01', [1, 2, 3, 4, 5]), '2029-07-02']);
  await work(qc, wkend!.id, days('2029-04-14', '2029-07-02', [0, 6]));

  // Ontario, Christmas 2027: Saturday, and Boxing Day the Sunday. Both guards work Monday to Friday for ten weeks;
  // the first also works Tuesday December 28, the second takes the week off.
  const [a, b] = on.users;
  await work(on, a!.id, [...days('2027-10-10', '2027-12-25', [1, 2, 3, 4, 5]), '2027-12-28']);
  await work(on, b!.id, days('2027-10-10', '2027-12-25', [1, 2, 3, 4, 5]));
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('holiday pay on the observed day', () => {
  it('Quebec 2029: Canada Day is July 2 by law, so July 2 is paid as the holiday and Sunday July 1 is an ordinary day', async () => {
    const [wkday, wkend] = qc.users;
    const r = await withTenant(qc.tenant.id, (tx) => runPayroll(tx, qc.tenant.id, '2029-07-01', 1));
    expect(hoursOf(r, wkday!.id, 'STAT_WORKED')).toBe(8);
    expect(hoursOf(r, wkday!.id, 'REGULAR')).toBe(0);
    expect(hoursOf(r, wkend!.id, 'STAT_WORKED')).toBe(0);
    expect(hoursOf(r, wkend!.id, 'REGULAR')).toBe(8);
    // Holiday pay (the indemnity) once each, for July 2.
    expect(holidayPayLines(r, wkday!.id)).toBe(1);
    expect(holidayPayLines(r, wkend!.id)).toBe(1);
  });

  it('Quebec 2029: the Fête nationale on a Sunday stays June 24 for someone who works Sundays', async () => {
    const [wkday, wkend] = qc.users;
    // The week of Sunday June 24: the weekend guard works it, the weekday guard has June 25 as the holiday.
    const r = await withTenant(qc.tenant.id, (tx) => runPayroll(tx, qc.tenant.id, '2029-06-24', 1));
    expect(hoursOf(r, wkend!.id, 'STAT_WORKED')).toBe(8); // Sunday June 24 worked
    expect(hoursOf(r, wkday!.id, 'STAT_WORKED')).toBe(8); // Monday June 25 worked
    expect(holidayPayLines(r, wkend!.id)).toBe(1);
    expect(holidayPayLines(r, wkday!.id)).toBe(1);
  });

  it('Ontario 2027, statutory days: Christmas and Boxing Day are both the weekday guards’ days off, so a substitute day is owed for each', async () => {
    const [a, b] = on.users;
    const r = await withTenant(on.tenant.id, (tx) => runPayroll(tx, on.tenant.id, '2027-12-19', 2));
    // Tuesday the 28th is an ordinary day (with the week of the 20th: 48 hours).
    expect(hoursOf(r, a!.id, 'STAT_WORKED')).toBe(0);
    expect(hoursOf(r, a!.id, 'REGULAR')).toBe(48);
    expect(holidayPayLines(r, a!.id)).toBe(2);
    expect(holidayPayLines(r, b!.id)).toBe(2);
    const owed = r.warnings.filter((w) => typeof w !== 'string' && w.code === 'STAT_SUBSTITUTE_DAY');
    expect(owed).toHaveLength(4);
  });

  it('Ontario 2027, observing the next weekday: Tuesday the 28th is paid at the holiday rate, and Monday off is the substitute for Christmas', async () => {
    const [a, b] = on.users;
    const put = await call('holon', hrOn).put('/api/settings/holidays', { observance: 'NEXT_WEEKDAY', offDayRule: null });
    expect(put.status).toBe(200);
    expect(await owner.auditLog.count({ where: { tenantId: on.tenant.id, action: 'settings.holidays' } })).toBe(1);
    const r = await withTenant(on.tenant.id, (tx) => runPayroll(tx, on.tenant.id, '2027-12-19', 2));
    expect(hoursOf(r, a!.id, 'STAT_WORKED')).toBe(8);
    expect(hoursOf(r, a!.id, 'REGULAR')).toBe(40); // the week of the 20th
    // Holiday pay once per holiday, not again for the observed day.
    expect(holidayPayLines(r, a!.id)).toBe(2);
    const owed = r.warnings.filter((w) => typeof w !== 'string' && w.code === 'STAT_SUBSTITUTE_DAY').map((w) => (typeof w === 'string' ? '' : `${w.params?.name}|${w.params?.date}`));
    // A worked Tuesday the 28th: Boxing Day's observed day wasn't a day off for the first guard. The second had both days off.
    expect(owed).toEqual([`${a!.firstName} ${a!.lastName}|2027-12-26`]);
    expect(holidayPayLines(r, b!.id)).toBe(2);
  });

  it('pays holiday pay instead of a substitute day when the organization chooses it and the province allows it', async () => {
    await call('holon', hrOn).put('/api/settings/holidays', { observance: 'STATUTORY', offDayRule: 'PAY' });
    const r = await withTenant(on.tenant.id, (tx) => runPayroll(tx, on.tenant.id, '2027-12-19', 2));
    expect(r.warnings.filter((w) => typeof w !== 'string' && w.code === 'STAT_SUBSTITUTE_DAY')).toHaveLength(0);
    expect(holidayPayLines(r, on.users[0]!.id)).toBe(2);
  });
});

describe('settings and calendars', () => {
  it('explains each facility province’s default and refuses an unknown choice', async () => {
    const r = await call('holon', hrOn).get('/api/settings/holidays');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ observance: 'STATUTORY', offDayRule: 'PAY', provinces: [{ province: 'ON', default: 'SUBSTITUTE', allowed: ['SUBSTITUTE', 'PAY'] }] });
    expect((await call('holon', hrOn).put('/api/settings/holidays', { observance: 'FRIDAY', offDayRule: null })).status).toBe(400);
    expect((await call('holon', supOn).get('/api/settings/holidays')).status).toBe(403);
  });

  it('lists the coming holidays with their own date and the day off, for anyone signed in', async () => {
    await call('holon', hrOn).put('/api/settings/holidays', { observance: 'NEXT_WEEKDAY', offDayRule: null });
    const r = await call('holon', supOn).get('/api/me/holidays?from=2027-12-01');
    expect(r.status).toBe(200);
    expect(r.body.holidays.slice(0, 2)).toMatchObject([
      { province: 'ON', key: 'CHRISTMAS', date: '2027-12-25', observedOn: null, closedOn: '2027-12-27' },
      { province: 'ON', key: 'BOXING_DAY', date: '2027-12-26', observedOn: null, closedOn: '2027-12-28' },
    ]);
    const q = await call('holqc', supQc).get('/api/me/holidays?from=2029-06-01');
    expect(q.body.holidays.slice(0, 2)).toMatchObject([
      { key: 'FETE_NATIONALE', date: '2029-06-24', kind: 'MOVED_IF_OFF', observedOn: '2029-06-25', closedOn: '2029-06-25' },
      { key: 'CANADA_DAY', date: '2029-07-01', kind: 'MOVED', observedOn: '2029-07-02', closedOn: '2029-07-02' },
    ]);
  });
});

describe('forecast', () => {
  const holidaysOn = (body: { days: Array<{ date: string; adjustments: Array<{ kind: string; name?: string; observed?: boolean }> }> }, date: string) =>
    body.days.find((d) => d.date === date)!.adjustments.filter((a) => a.kind === 'holiday');

  it('uses the organization’s observed weekday for Christmas and Boxing Day 2027', async () => {
    // The organization observes the next weekday (set above).
    const r = await call('holon', supOn).get(`/api/forecast?facilityId=${on.facility.id}&weekStart=2027-12-25`);
    expect(r.status).toBe(200);
    expect(holidaysOn(r.body, '2027-12-25')).toMatchObject([{ name: 'Christmas Day' }]);
    expect(holidaysOn(r.body, '2027-12-27')).toMatchObject([{ name: 'Christmas Day', observed: true }]);
    expect(holidaysOn(r.body, '2027-12-28')).toMatchObject([{ name: 'Boxing Day', observed: true }]);
    await call('holon', hrOn).put('/api/settings/holidays', { observance: 'STATUTORY', offDayRule: null });
    const s = await call('holon', supOn).get(`/api/forecast?facilityId=${on.facility.id}&weekStart=2027-12-25`);
    expect(holidaysOn(s.body, '2027-12-27')).toEqual([]);
    expect(holidaysOn(s.body, '2027-12-26')).toMatchObject([{ name: 'Boxing Day' }]);
  });

  it('puts Canada Day 2029 on Monday July 2 in Quebec, by law', async () => {
    const r = await call('holqc', supQc).get(`/api/forecast?facilityId=${qc.facility.id}&weekStart=2029-07-01`);
    expect(r.status).toBe(200);
    expect(holidaysOn(r.body, '2029-07-02')).toMatchObject([{ name: 'Canada Day', observed: true }]);
    expect(holidaysOn(r.body, '2029-07-03')).toEqual([]);
  });
});
