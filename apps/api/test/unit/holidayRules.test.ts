import { describe, expect, it } from 'vitest';
import { OFF_DAY_POLICIES, offDayRule, organizationDay, personalDay, premiumDays, statutoryDay, usuallyWorks, type HolidayRowLike } from '../../src/services/payroll/holidayRules.js';
import { JURISDICTION_HOLIDAYS, statHolidays } from '../../src/services/payroll/statHolidays.js';

const row = (j: Parameters<typeof statHolidays>[0], y: number, key: string): HolidayRowLike => {
  const h = statHolidays(j, y).find((x) => x.key === key)!;
  return { date: h.date, key: h.key, name: h.name, nameFr: h.nameFr, kind: h.kind, observedOn: h.observedOn, weekdayOn: h.weekdayOn };
};
/** Every given weekday in the 9 weeks before a date. */
const weekly = (before: string, weekday: number, weeks = 9) => {
  const t = Date.parse(`${before}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 1; i <= 70; i++) {
    const d = new Date(t - i * 86_400_000);
    if (d.getUTCDay() === weekday && out.length < weeks) out.push(d.toISOString().slice(0, 10));
  }
  return new Set(out);
};

describe('holiday on a day off: rules per jurisdiction', () => {
  it('has a rule and a source for every jurisdiction', () => {
    for (const j of Object.keys(JURISDICTION_HOLIDAYS) as Array<keyof typeof OFF_DAY_POLICIES>) {
      const p = OFF_DAY_POLICIES[j];
      expect(p.source.length).toBeGreaterThan(10);
      if (p.default !== 'NONE') expect(p.allowed).toContain(p.default);
    }
  });

  it('uses each province’s default, and the organization’s choice only where the law allows one', () => {
    expect(offDayRule('ON', 'CHRISTMAS', null).rule).toBe('SUBSTITUTE');
    expect(offDayRule('ON', 'CHRISTMAS', 'PAY').rule).toBe('PAY'); // with the employee's written agreement (ESA s. 27(2)(b))
    expect(offDayRule('BC', 'CHRISTMAS', null).rule).toBe('PAY');
    expect(offDayRule('SK', 'CHRISTMAS', null).rule).toBe('PAY');
    expect(offDayRule('QC', 'CANADA_DAY', null).rule).toBe('PAY');
    expect(offDayRule('AB', 'CHRISTMAS', null).rule).toBe('NONE');
    expect(offDayRule('AB', 'CHRISTMAS', 'SUBSTITUTE').rule).toBe('SUBSTITUTE'); // more generous is always allowed
    // Federal and Manitoba: a day off, never pay instead.
    expect(offDayRule('FED', 'BOXING_DAY', 'PAY').rule).toBe('SUBSTITUTE');
    expect(offDayRule('MB', 'CHRISTMAS', 'PAY').rule).toBe('SUBSTITUTE');
  });

  it('gives nothing for Nova Scotia’s Remembrance Day on a day off (its own Act), unlike its general holidays', () => {
    expect(offDayRule('NS', 'REMEMBRANCE_DAY', null).rule).toBe('NONE');
    expect(offDayRule('NS', 'REMEMBRANCE_DAY', null).source).toMatch(/Remembrance Day Act/);
    expect(offDayRule('NS', 'CHRISTMAS', null).rule).toBe('SUBSTITUTE');
    expect(offDayRule('NB', 'REMEMBRANCE_DAY', null).rule).toBe('SUBSTITUTE');
  });
});

describe('the person’s own pattern of work', () => {
  it('counts a weekday as usual when worked in 5 of the 9 weeks before', () => {
    const sundays = weekly('2029-06-24', 0);
    expect(usuallyWorks(sundays, '2029-06-24')).toBe(true);
    expect(usuallyWorks(new Set([...sundays].slice(0, 4)), '2029-06-24')).toBe(false);
    expect(usuallyWorks(new Set([...sundays].slice(0, 5)), '2029-06-24')).toBe(true);
    expect(usuallyWorks(weekly('2029-06-24', 1), '2029-06-24')).toBe(false);
  });

  it('keeps the Fête nationale on Sunday June 24 for someone who works Sundays, June 25 for others', () => {
    const fete = row('QC', 2029, 'FETE_NATIONALE');
    expect(personalDay(fete, (d) => usuallyWorks(weekly('2029-06-24', 0), d))).toBe('2029-06-24');
    expect(personalDay(fete, (d) => usuallyWorks(weekly('2029-06-24', 1), d))).toBe('2029-06-25');
    expect(statutoryDay(fete)).toBe('2029-06-25');
  });

  it('puts Canada Day 2029 on July 2 in Quebec for everyone, whatever their schedule', () => {
    const cd = row('QC', 2029, 'CANADA_DAY');
    expect(personalDay(cd, () => true)).toBe('2029-07-02');
    expect([...premiumDays([cd], 'STATUTORY', () => true)]).toEqual(['2029-07-02']);
    expect(organizationDay(cd, 'NEXT_WEEKDAY')).toBe('2029-07-02');
  });
});

describe('premium days and the organization’s observed day', () => {
  const xmas = row('ON', 2027, 'CHRISTMAS');
  const boxing = row('ON', 2027, 'BOXING_DAY');

  it('observes Christmas and Boxing Day 2027 on Monday and Tuesday where the organization observes weekdays', () => {
    expect(organizationDay(xmas, 'STATUTORY')).toBe('2027-12-25');
    expect(organizationDay(xmas, 'NEXT_WEEKDAY')).toBe('2027-12-27');
    expect(organizationDay(boxing, 'NEXT_WEEKDAY')).toBe('2027-12-28');
  });

  it('pays the holiday rate on the statutory day, and on the observed weekday too where the organization observes it', () => {
    expect([...premiumDays([xmas, boxing], 'STATUTORY', () => false)].sort()).toEqual(['2027-12-25', '2027-12-26']);
    expect([...premiumDays([xmas, boxing], 'NEXT_WEEKDAY', () => false)].sort()).toEqual(['2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28']);
  });

  it('observes Remembrance Day 2029 (a Sunday) on Monday only where it is statutory', () => {
    expect(organizationDay(row('BC', 2029, 'REMEMBRANCE_DAY'), 'NEXT_WEEKDAY')).toBe('2029-11-12');
    expect(organizationDay(row('NS', 2029, 'REMEMBRANCE_DAY'), 'STATUTORY')).toBe('2029-11-11');
    expect(statHolidays('ON', 2029).some((h) => h.key === 'REMEMBRANCE_DAY')).toBe(false);
  });
});
