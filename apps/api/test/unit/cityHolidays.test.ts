import { describe, expect, it } from 'vitest';
import { type CityHolidayRule, cityHolidayDates, cityHolidayIn, validRule } from '../../src/services/payroll/cityHolidays.js';
import { type HolidayRowLike, holidayRow, isPaidHoliday, mergeCityHolidays, organizationDay, premiumDays } from '../../src/services/payroll/holidayRules.js';
import { statHolidays } from '../../src/services/payroll/statHolidays.js';
import { holidayWeekdays, leaveHoursOff } from '../../src/services/people/leaveHours.js';

describe('leave on holidays', () => {
  const VAN = 'America/Vancouver';
  // 08:00 in Vancouver (16:00 UTC): a day read in UTC 12 hours in would be the next day.
  const at = (iso: string) => new Date(`${iso}T16:00:00Z`);
  it('the weekday fallback leaves out holidays and closure days, each day read in the person’s zone; scheduled shifts are charged as they are', () => {
    const week = { startsAt: at('2030-03-11'), endsAt: at('2030-03-16') };
    const off = new Set(['2030-03-12', '2030-03-14', '2030-03-16']);
    expect(holidayWeekdays(week.startsAt, week.endsAt, off, VAN)).toBe(2);
    expect(leaveHoursOff(week, [], VAN, off)).toEqual({ hours: 24, basis: 'WEEKDAYS' });
    expect(leaveHoursOff(week, [], VAN, new Set())).toEqual({ hours: 40, basis: 'WEEKDAYS' });
    // Friday March 15 08:00 to Saturday 08:00 in Vancouver is Friday: a Friday holiday isn't charged.
    expect(leaveHoursOff({ startsAt: at('2030-03-15'), endsAt: at('2030-03-16') }, [], VAN, new Set(['2030-03-15']))).toEqual({ hours: 0, basis: 'WEEKDAYS' });
    expect(leaveHoursOff({ startsAt: at('2030-03-15'), endsAt: at('2030-03-16') }, [], VAN, new Set(['2030-03-16']))).toEqual({ hours: 8, basis: 'WEEKDAYS' });
    const shift = { startsAt: new Date('2030-03-12T16:00:00Z'), endsAt: new Date('2030-03-13T00:00:00Z') };
    expect(leaveHoursOff(week, [shift], VAN, off)).toEqual({ hours: 8, basis: 'SHIFTS' });
    // A few hours off on the holiday itself, with nothing scheduled: nothing to charge.
    expect(leaveHoursOff({ startsAt: new Date('2030-03-12T16:00:00Z'), endsAt: new Date('2030-03-12T20:00:00Z') }, [], VAN, off)).toEqual({ hours: 0, basis: 'WEEKDAYS' });
  });
});

const rule = (date: string, recurrence: CityHolidayRule['recurrence'], extra: Partial<CityHolidayRule> = {}): CityHolidayRule => ({ id: 'x', name: 'Test', nameFr: 'Essai', kind: 'PAID', date, recurrence, untilYear: null, province: null, ...extra });
const stat = (j: 'BC' | 'ON' | 'QC' | 'SK', y: number): HolidayRowLike[] =>
  statHolidays(j, y).map((h) => holidayRow({ date: new Date(`${h.date}T00:00:00Z`), key: h.key, name: h.name, nameFr: h.nameFr, kind: h.kind, observedOn: h.observedOn ? new Date(`${h.observedOn}T00:00:00Z`) : null, weekdayOn: h.weekdayOn ? new Date(`${h.weekdayOn}T00:00:00Z`) : null }));

describe('city holiday rules', () => {
  it('a one-off day only in its own year', () => {
    expect(cityHolidayIn(rule('2027-03-12', 'NONE'), 2027)).toBe('2027-03-12');
    expect(cityHolidayIn(rule('2027-03-12', 'NONE'), 2028)).toBeNull();
  });

  it('the same date each year from the first year, until the last', () => {
    const r = rule('2026-12-26', 'YEARLY_DATE', { untilYear: 2028 });
    expect(cityHolidayIn(r, 2025)).toBeNull();
    expect(cityHolidayIn(r, 2027)).toBe('2027-12-26');
    expect(cityHolidayIn(r, 2029)).toBeNull();
    expect(cityHolidayIn(rule('2028-02-29', 'YEARLY_DATE'), 2029)).toBe('2029-02-28');
  });

  it('the nth weekday of the month: Ontario’s Civic Holiday is the first Monday of August', () => {
    const civic = rule('2026-08-03', 'YEARLY_NTH_WEEKDAY');
    expect([2026, 2027, 2028, 2029].map((y) => cityHolidayIn(civic, y))).toEqual(['2026-08-03', '2027-08-02', '2028-08-07', '2029-08-06']);
    expect(validRule(rule('2026-08-31', 'YEARLY_NTH_WEEKDAY'))).toBe('NTH_WEEKDAY_FIFTH');
  });

  it('the last weekday of the month', () => {
    const r = rule('2026-05-25', 'YEARLY_LAST_WEEKDAY');
    expect([2027, 2028].map((y) => cityHolidayIn(r, y))).toEqual(['2027-05-31', '2028-05-29']);
  });

  it('days from Easter: Easter Monday (Quebec’s choice instead of Good Friday, or an agreement’s)', () => {
    const r = rule('2026-04-06', 'EASTER_OFFSET');
    expect([2026, 2027, 2028, 2029].map((y) => cityHolidayIn(r, y))).toEqual(['2026-04-06', '2027-03-29', '2028-04-17', '2029-04-02']);
  });

  it('lists every day in a range and refuses a last year before the first', () => {
    expect(cityHolidayDates(rule('2026-12-26', 'YEARLY_DATE'), '2026-01-01', '2029-01-01')).toEqual(['2026-12-26', '2027-12-26', '2028-12-26']);
    expect(validRule(rule('2027-01-01', 'YEARLY_DATE', { untilYear: 2026 }))).toBe('UNTIL_BEFORE_START');
  });
});

describe('merged with the statutory holidays', () => {
  it('BC: Boxing Day added by the city is a paid holiday next to the statutory Christmas', () => {
    const rows = mergeCityHolidays(stat('BC', 2027), [rule('2026-12-26', 'YEARLY_DATE')], 'BC', '2027-12-01', '2028-01-01');
    const boxing = rows.find((h) => h.date === '2027-12-26')!;
    expect(boxing).toMatchObject({ source: 'CITY', paid: true, name: 'Test', nameFr: 'Essai' });
    // Christmas 2027 is a Saturday (weekday Monday the 27th), Boxing Day the Sunday: the next free weekday is Tuesday the 28th.
    expect(boxing.weekdayOn).toBe('2027-12-28');
    expect(organizationDay(boxing, 'NEXT_WEEKDAY')).toBe('2027-12-28');
  });

  it('a day the province already makes a holiday is not added twice (ON Boxing Day is statutory)', () => {
    const rows = mergeCityHolidays(stat('ON', 2027), [rule('2026-12-26', 'YEARLY_DATE')], 'ON', '2027-12-01', '2028-01-01');
    expect(rows.filter((h) => h.date === '2027-12-26')).toHaveLength(1);
    expect(rows.find((h) => h.date === '2027-12-26')!.source).toBeUndefined();
  });

  it('only the province a holiday is for, and a closure day is a day off but not paid', () => {
    const city = [rule('2027-08-02', 'NONE', { province: 'SK' }), rule('2027-12-29', 'NONE', { kind: 'CLOSURE' })];
    const qc = mergeCityHolidays(stat('QC', 2027), city, 'QC', '2027-01-01', '2028-01-01');
    expect(qc.some((h) => h.date === '2027-08-02')).toBe(false);
    const sk = mergeCityHolidays(stat('SK', 2027), city, 'SK', '2027-01-01', '2028-01-01');
    // SK's own Saskatchewan Day is statutory that day: only the statutory row.
    expect(sk.filter((h) => h.date === '2027-08-02').map((h) => h.source ?? 'STATUTORY')).toEqual(['STATUTORY']);
    const closure = sk.find((h) => h.date === '2027-12-29')!;
    expect(closure.paid).toBe(false);
    expect(isPaidHoliday(closure)).toBe(false);
    expect(premiumDays(sk.filter(isPaidHoliday), 'STATUTORY', () => true).has('2027-12-29')).toBe(false);
  });

  it('statutory rows keep behaving as before (paid, no source)', () => {
    for (const j of ['BC', 'ON', 'QC', 'SK'] as const) {
      const before = stat(j, 2028);
      const after = mergeCityHolidays(before, [], j, '2028-01-01', '2029-01-01');
      expect(after).toEqual(before);
      expect(after.every(isPaidHoliday)).toBe(true);
    }
  });
});
