import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { resolveRules } from '../../src/services/compliance/provincialRules.js';
import { type PayCalcInput, calculatePay } from '../../src/services/payroll/payCalc.js';
import { EDM, TOR, VAN, iv } from '../helpers.js';

// Week of Sunday 2026-07-05 (pay week starts Sunday).
const base = (over: Partial<PayCalcInput>): PayCalcInput => ({
  intervals: [],
  timezone: VAN,
  payWeekStartDay: 0,
  periodStart: '2026-07-05',
  weeks: 1,
  rules: resolveRules('BC', '2026-07-05'),
  rateFor: () => new Decimal('20.00'),
  statHolidays: new Set(),
  completedYearsOfService: 0,
  vacationPayMode: 'PAY_EACH_PERIOD',
  ...over,
});

const hours = (r: ReturnType<typeof calculatePay>, code: string) =>
  r.lines.filter((l) => l.code === code).reduce((s, l) => s.plus(l.hours), new Decimal(0)).toNumber();

describe('calculatePay — BC', () => {
  it('accumulates split shifts on the same day before applying daily OT', () => {
    const r = calculatePay(base({ intervals: [iv('2026-07-06 06:00', '2026-07-06 12:00'), iv('2026-07-06 14:00', '2026-07-06 18:00')] }));
    expect(hours(r, 'REGULAR')).toBe(8);
    expect(hours(r, 'OVERTIME_1_5')).toBe(2);
  });

  it('applies double time after 12 hours in a day', () => {
    const r = calculatePay(base({ intervals: [iv('2026-07-06 06:00', '2026-07-06 19:00')] }));
    expect(hours(r, 'REGULAR')).toBe(8);
    expect(hours(r, 'OVERTIME_1_5')).toBe(4);
    expect(hours(r, 'OVERTIME_2_0')).toBe(1);
  });

  it('applies weekly OT over 40 regular hours', () => {
    const days = ['06', '07', '08', '09', '10', '11'];
    const r = calculatePay(base({ intervals: days.map((d) => iv(`2026-07-${d} 08:00`, `2026-07-${d} 16:00`)) }));
    expect(hours(r, 'REGULAR')).toBe(40);
    expect(hours(r, 'OVERTIME_1_5')).toBe(8);
  });

  it('does not double count daily OT toward the weekly threshold (stacked)', () => {
    const weekdays = ['06', '07', '08', '09', '10'].map((d) => iv(`2026-07-${d} 08:00`, `2026-07-${d} 17:00`));
    const r = calculatePay(base({ intervals: [...weekdays, iv('2026-07-11 08:00', '2026-07-11 13:00')] }));
    // 5 × 1h daily OT; 40 regular; Saturday's 5h all beyond 40 regular → weekly OT
    expect(hours(r, 'REGULAR')).toBe(40);
    expect(hours(r, 'OVERTIME_1_5')).toBe(10);
  });

  it('splits overnight shifts at local midnight into two work days', () => {
    const r = calculatePay(base({ intervals: [iv('2026-07-06 22:00', '2026-07-07 06:00')] }));
    expect(hours(r, 'REGULAR')).toBe(8);
    expect(hours(r, 'OVERTIME_1_5')).toBe(0);
  });

  it('uses real elapsed time across the DST change', () => {
    // Toronto falls back at 02:00 on 2026-11-01: 00:00→08:00 local is 9 real hours.
    // (Uses Toronto because tzdata 2026e has BC on permanent UTC−7 from 2026 — no fall-back.)
    const r = calculatePay(
      base({ timezone: TOR, periodStart: '2026-11-01', intervals: [iv('2026-11-01 00:00', '2026-11-01 08:00', TOR)] }),
    );
    expect(hours(r, 'REGULAR')).toBe(8);
    expect(hours(r, 'OVERTIME_1_5')).toBe(1);
  });

  it('computes money with decimals and adds 4% vacation pay', () => {
    const r = calculatePay(base({ rateFor: () => new Decimal('20.50'), intervals: [iv('2026-07-06 08:00', '2026-07-06 18:00')] }));
    expect(r.grossWages.toFixed(2)).toBe('225.50'); // 8×20.50 + 2×30.75
    expect(r.vacationPay.toFixed(2)).toBe('9.02');
  });

  it('accrues vacation instead of paying when configured', () => {
    const r = calculatePay(base({ vacationPayMode: 'ACCRUE', intervals: [iv('2026-07-06 08:00', '2026-07-06 16:00')] }));
    expect(r.vacationPay.toNumber()).toBe(0);
    expect(r.vacationAccrued.toFixed(2)).toBe('6.40');
  });

  it('uses 6% vacation after 5 years', () => {
    const r = calculatePay(base({ completedYearsOfService: 5, intervals: [iv('2026-07-06 08:00', '2026-07-06 16:00')] }));
    expect(r.vacationPercent).toBe(6);
  });

  it('pays stat-holiday hours at the worked multiplier', () => {
    const r = calculatePay(base({ statHolidays: new Set(['2026-07-01']), periodStart: '2026-06-28', intervals: [iv('2026-07-01 08:00', '2026-07-01 16:00')] }));
    expect(hours(r, 'STAT_WORKED')).toBe(8);
    expect(r.grossWages.toFixed(2)).toBe('240.00');
  });

  it('pays positions at their own rates', () => {
    const r = calculatePay(
      base({
        rateFor: (p) => new Decimal(p === 'instructor' ? '24.00' : '20.00'),
        intervals: [iv('2026-07-06 08:00', '2026-07-06 12:00', VAN, 'guard'), iv('2026-07-06 13:00', '2026-07-06 15:00', VAN, 'instructor')],
      }),
    );
    expect(r.grossWages.toFixed(2)).toBe('128.00');
  });

  it('adds shift premiums as a separate line', () => {
    const r = calculatePay(base({ intervals: [{ ...iv('2026-07-06 08:00', '2026-07-06 10:00'), premiumPerHour: new Decimal('2.00') }] }));
    expect(r.lines.find((l) => l.code === 'SHIFT_PREMIUM')?.amount.toFixed(2)).toBe('4.00');
  });

  it('clips punches that cross the period boundary instead of dropping them', () => {
    const r = calculatePay(base({ intervals: [iv('2026-07-11 20:00', '2026-07-12 04:00')] }));
    expect(r.totalHours.toNumber()).toBe(4);
  });

  it('rejects periods that do not start on the pay-week start', () => {
    expect(() => calculatePay(base({ periodStart: '2026-07-06' }))).toThrow(/pay-week start/);
  });

  it('warns that rules are unverified', () => {
    expect(calculatePay(base({})).warnings[0]).toMatch(/not been verified/);
  });
});

describe('calculatePay — other provinces', () => {
  it('ON: weekly OT only, after 44', () => {
    const days = ['06', '07', '08', '09'].map((d) => iv(`2026-07-${d} 08:00`, `2026-07-${d} 20:00`, TOR));
    const r = calculatePay(base({ timezone: TOR, rules: resolveRules('ON', '2026-07-05'), intervals: days }));
    expect(hours(r, 'REGULAR')).toBe(44);
    expect(hours(r, 'OVERTIME_1_5')).toBe(4);
  });

  it('AB: pays daily OT when it is greater than weekly OT', () => {
    const days = ['06', '07', '08', '09'].map((d) => iv(`2026-07-${d} 08:00`, `2026-07-${d} 19:00`, EDM));
    const r = calculatePay(base({ timezone: EDM, rules: resolveRules('AB', '2026-07-05'), intervals: days }));
    expect(hours(r, 'OVERTIME_1_5')).toBe(12);
  });

  it('AB: pays weekly OT when it is greater than daily OT', () => {
    const days = ['05', '06', '07', '08', '09', '10'].map((d) => iv(`2026-07-${d} 08:00`, `2026-07-${d} 16:00`, EDM));
    const r = calculatePay(base({ timezone: EDM, rules: resolveRules('AB', '2026-07-05'), intervals: days }));
    expect(hours(r, 'REGULAR')).toBe(44);
    expect(hours(r, 'OVERTIME_1_5')).toBe(4);
  });

  it('applies tenant overrides (e.g. a CBA with 7.5h daily OT)', () => {
    const rules = resolveRules('BC', '2026-07-05', [
      { province: 'BC', ruleKey: 'overtime.dailyHours', value: 7.5, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]);
    const r = calculatePay(base({ rules, intervals: [iv('2026-07-06 08:00', '2026-07-06 16:00')] }));
    expect(hours(r, 'OVERTIME_1_5')).toBe(0.5);
  });
});
