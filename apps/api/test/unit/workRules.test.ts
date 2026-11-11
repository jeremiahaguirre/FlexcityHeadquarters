import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { mealBreakRule, reportingPayRule, resolveRules } from '../../src/services/compliance/provincialRules.js';
import { type PayCalcInput, calculatePay } from '../../src/services/payroll/payCalc.js';
import { addEarning } from '../../src/services/payroll/workRulePay.js';
import { projectOvertime } from '../../src/services/scheduling/eligibility.js';
import {
  type PremiumRule,
  breakWarning,
  breakWindow,
  callbackMinimum,
  changeNotice,
  changePremiumAmount,
  effectiveWorkRules,
  minimumShiftHours,
  paidHours,
  paidIntervals,
  parseWorkRules,
  premiumPieces,
  reportingMinimum,
  reportingTopUp,
  requiredBreakMinutes,
  standbyPay,
} from '../../src/services/scheduling/workRules.js';
import { twoPersonViolations } from '../../src/services/scheduling/twoPerson.js';
import { EDM, TOR, VAN, at, iv } from '../helpers.js';

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
const hours = (r: ReturnType<typeof calculatePay>, code: string) => r.lines.filter((l) => l.code === code).reduce((s, l) => s.plus(l.hours), new Decimal(0)).toNumber();
const amount = (r: ReturnType<typeof calculatePay>, code: string) => r.lines.filter((l) => l.code === code).reduce((s, l) => s.plus(l.amount), new Decimal(0)).toNumber();

describe('settings', () => {
  it('defaults: breaks warn, call-in on (province minimum), notice premiums off, standby off, 3 h call-back', () => {
    const w = parseWorkRules({});
    expect(w.breaks).toEqual({ breakAfterHours: null, warnMissing: true });
    expect(w.callIn).toEqual({ enabled: true, minHours: null });
    expect(w.notice.lateChangeHours).toBeNull();
    expect(w.standby.perDay).toBeNull();
    expect(w.standby.callbackMinHours).toBe(3);
    expect(w.premiums).toEqual([]);
  });
  it('a department’s own values win; the rest fall back to the organization’s; invalid values are ignored', () => {
    const w = parseWorkRules({ notice: { lateChangeHours: 48, multiplier: 1.5 }, departments: { d1: { notice: { lateChangeHours: 72 } }, d2: { notice: { lateChangeHours: 'x' } } }, premiums: [{ nope: 1 }] });
    expect(effectiveWorkRules(w, 'd1').notice).toMatchObject({ lateChangeHours: 72, multiplier: 1.5 });
    expect(effectiveWorkRules(w, 'd2').notice.lateChangeHours).toBe(48);
    expect(effectiveWorkRules(w, null).notice.lateChangeHours).toBe(48);
    expect(w.premiums).toEqual([]);
  });
});

describe('unpaid meal breaks', () => {
  it('the break sits mid-shift but starts by the province’s 5 hours', () => {
    const w = breakWindow(at('2026-07-06 07:00'), at('2026-07-06 19:00'), 30, 5)!;
    expect(w.start).toEqual(at('2026-07-06 12:00'));
    expect(w.end).toEqual(at('2026-07-06 12:30'));
    const mid = breakWindow(at('2026-07-06 08:00'), at('2026-07-06 16:30'), 30, null)!;
    expect(mid.start).toEqual(at('2026-07-06 12:00'));
  });
  it('paid hours = length − break', () => {
    expect(paidHours({ start: at('2026-07-06 08:00'), end: at('2026-07-06 16:30'), breakMinutes: 30 })).toBe(8);
    expect(paidIntervals({ start: at('2026-07-06 08:00'), end: at('2026-07-06 16:30'), breakMinutes: 30 })).toHaveLength(2);
    expect(paidIntervals({ start: at('2026-07-06 08:00'), end: at('2026-07-06 08:20'), breakMinutes: 30 })).toHaveLength(1);
  });
  it('BC: 08:00–16:30 with a 30-minute lunch is 8 regular hours, no daily overtime (finding 10)', () => {
    const r = calculatePay(base({ intervals: [{ ...iv('2026-07-06 08:00', '2026-07-06 16:30'), breakMinutes: 30 }] }));
    expect(hours(r, 'REGULAR')).toBe(8);
    expect(hours(r, 'OVERTIME_1_5')).toBe(0);
    // Without the break: half an hour of overtime.
    const r2 = calculatePay(base({ intervals: [iv('2026-07-06 08:00', '2026-07-06 16:30')] }));
    expect(hours(r2, 'OVERTIME_1_5')).toBe(0.5);
  });
  it('AB overnight 18:00–06:30 with 30 minutes off: the 24-hour day counts 12 paid hours', () => {
    const r = calculatePay(base({ timezone: EDM, rules: resolveRules('AB', '2026-07-05'), intervals: [{ ...iv('2026-07-06 18:00', '2026-07-07 06:30', EDM), breakMinutes: 30 }] }));
    expect(hours(r, 'REGULAR') + hours(r, 'OVERTIME_1_5')).toBe(12);
    expect(hours(r, 'OVERTIME_1_5')).toBe(4);
  });
  it('overtime projections use paid hours (the scheduler and the pay stub agree)', () => {
    const shift = { ...iv('2026-07-06 08:00', '2026-07-06 16:30'), id: 's', timezone: VAN, breakMinutes: 30 };
    const p = projectOvertime([], shift, { rules: resolveRules('BC', '2026-07-05'), payWeekStartDay: 0 });
    expect(p.overtimeHours.toNumber()).toBe(0);
    expect(p.weeklyHoursAfter.toNumber()).toBe(8);
  });
  it('warns when a shift is long enough to need a break and none (or too little) is planned', () => {
    const on = mealBreakRule('ON')!;
    expect(breakWarning(8, 0, on)).toMatchObject({ code: 'BREAK_MISSING', requiredMinutes: 30 });
    expect(breakWarning(8, 15, on)).toMatchObject({ code: 'BREAK_SHORT' });
    expect(breakWarning(8, 30, on)).toBeNull();
    expect(breakWarning(5, 0, on)).toBeNull();
    expect(breakWarning(8, 0, on, { warnMissing: false })).toBeNull();
    // A 12-hour shift needs two breaks; NL’s break is an hour.
    expect(requiredBreakMinutes(12, on)).toBe(60);
    expect(requiredBreakMinutes(8, mealBreakRule('NL'))).toBe(60);
    expect(requiredBreakMinutes(11, mealBreakRule('AB'))).toBe(60);
    expect(requiredBreakMinutes(8, null)).toBe(0);
  });
  it('every province with a statutory break is encoded with a source', () => {
    for (const p of ['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT'] as const) {
      const r = resolveRules(p, '2026-07-05');
      expect(r.mealBreak?.source).toBeTruthy();
    }
    expect(resolveRules('ON', '2026-07-05', [], { federal: true }).mealBreak?.source).toMatch(/Canada Labour Code/);
  });
});

describe('minimum call-in (reporting) pay', () => {
  it('province minimums: ON 3 h, BC 2 h or 4 h when scheduled over 8 h; the organization can only raise it', () => {
    const on = reportingPayRule('ON');
    const bc = reportingPayRule('BC');
    expect(reportingMinimum({ enabled: true, minHours: null }, on, 4)?.minHours).toBe(3);
    expect(reportingMinimum({ enabled: true, minHours: null }, bc, 8)?.minHours).toBe(2);
    expect(reportingMinimum({ enabled: true, minHours: null }, bc, 10)?.minHours).toBe(4);
    expect(reportingMinimum({ enabled: true, minHours: 4 }, on, 4)).toEqual({ minHours: 4, source: 'organization' });
    expect(reportingMinimum({ enabled: true, minHours: 1 }, on, 4)?.minHours).toBe(3);
    expect(reportingMinimum({ enabled: false, minHours: 4 }, on, 4)).toBeNull();
  });
  it('tops up only someone who worked less than the minimum', () => {
    const m = { minHours: 3, source: 'province' as const };
    expect(reportingTopUp(1.5, m)).toBe(1.5);
    expect(reportingTopUp(3, m)).toBe(0);
    expect(reportingTopUp(0, m)).toBe(0);
    expect(minimumShiftHours({ enabled: true, minHours: null }, reportingPayRule('BC'), 3)).toBe(2);
    expect(minimumShiftHours({ enabled: false, minHours: null }, reportingPayRule('BC'), 3)).toBe(3);
  });
  it('the top-up line adds vacation pay like any wage', () => {
    const r = calculatePay(base({ intervals: [iv('2026-07-06 08:00', '2026-07-06 09:30')] }));
    const before = r.grossWages.toNumber();
    addEarning(r, { code: 'REPORTING_PAY', positionId: 'guard', hours: new Decimal(0.5), rate: new Decimal(20), multiplier: new Decimal(1) }, 'PAY_EACH_PERIOD');
    expect(r.grossWages.toNumber()).toBe(before + 10);
    expect(amount(r, 'REPORTING_PAY')).toBe(10);
    expect(amount(r, 'VACATION_PAY')).toBe(1.6);
    expect(r.lines.at(-1)!.code).toBe('VACATION_PAY');
  });
});

describe('shift premiums', () => {
  const rule = (over: Partial<PremiumRule>): PremiumRule => ({ id: 'r', name: 'r', nameFr: null, kind: 'custom', days: [], startMinute: 0, endMinute: 1440, holidaysOnly: false, perHour: null, percent: null, departmentIds: [], positionIds: [], active: true, ...over });
  const evening = rule({ id: 'eve', kind: 'evening', startMinute: 18 * 60, endMinute: 23 * 60, perHour: 1.5 });
  const night = rule({ id: 'night', kind: 'night', startMinute: 23 * 60, endMinute: 31 * 60, perHour: 2 });
  const weekend = rule({ id: 'wknd', kind: 'weekend', days: [0, 6], percent: 10 });
  const holiday = rule({ id: 'hol', kind: 'holiday', holidaysOnly: true, perHour: 3 });
  const ctx = { timezone: VAN, departmentId: 'd1', positionId: 'guard', holidays: new Set(['2026-07-01']) };

  it('counts hours inside each rule’s windows, past midnight too', () => {
    const p = premiumPieces(iv('2026-07-06 16:00', '2026-07-07 02:00'), [evening, night], ctx);
    expect(p.find((x) => x.ruleId === 'eve')?.hours).toBe(5);
    expect(p.find((x) => x.ruleId === 'night')?.hours).toBe(3);
  });
  it('a night window from the day before covers the early morning', () => {
    const p = premiumPieces(iv('2026-07-07 04:00', '2026-07-07 12:00'), [night], ctx);
    expect(p[0]?.hours).toBe(3);
  });
  it('weekend (by day) and holiday-only rules; department and position filters', () => {
    expect(premiumPieces(iv('2026-07-11 08:00', '2026-07-11 16:00'), [weekend], ctx)[0]?.hours).toBe(8);
    expect(premiumPieces(iv('2026-07-06 08:00', '2026-07-06 16:00'), [weekend], ctx)).toEqual([]);
    expect(premiumPieces(iv('2026-07-01 08:00', '2026-07-01 12:00'), [holiday], ctx)[0]?.hours).toBe(4);
    expect(premiumPieces(iv('2026-07-02 08:00', '2026-07-02 12:00'), [holiday], ctx)).toEqual([]);
    expect(premiumPieces(iv('2026-07-06 18:00', '2026-07-06 20:00'), [{ ...evening, departmentIds: ['other'] }], ctx)).toEqual([]);
    expect(premiumPieces(iv('2026-07-06 18:00', '2026-07-06 20:00'), [{ ...evening, positionIds: ['other'] }], ctx)).toEqual([]);
  });
  it('DST: a 22:00–06:00 window is wall-clock on the changeover night', () => {
    // 2026-11-01 Toronto falls back at 02:00: the night is 9 real hours.
    const p = premiumPieces(iv('2026-10-31 22:00', '2026-11-01 06:00', TOR), [rule({ id: 'n', startMinute: 22 * 60, endMinute: 30 * 60, perHour: 1 })], { ...ctx, timezone: TOR });
    expect(p[0]?.hours).toBe(9);
  });
  it('payroll pays rule premiums as shift-premium lines, $/h and % of the rate, on paid hours only', () => {
    const r = calculatePay(base({
      intervals: [{ ...iv('2026-07-11 08:00', '2026-07-11 16:30'), breakMinutes: 30 }],
      rulePremiums: (piece) => premiumPieces(piece, [weekend], ctx),
    }));
    expect(amount(r, 'SHIFT_PREMIUM')).toBe(16); // 8 h × 10% × $20
    expect(hours(r, 'REGULAR')).toBe(8);
  });
  it('the manual premiumPerHour still applies as an override on top', () => {
    const r = calculatePay(base({ intervals: [{ ...iv('2026-07-06 18:00', '2026-07-06 20:00'), premiumPerHour: new Decimal(1) }], rulePremiums: (piece) => premiumPieces(piece, [evening], ctx) }));
    expect(amount(r, 'SHIFT_PREMIUM')).toBe(5); // 2 × $1 + 2 × $1.50
  });
});

describe('regression: shifts without these rules pay exactly as before', () => {
  it('same lines and totals with no breaks, no premium rules', () => {
    const intervals = ['06', '07', '08', '09', '10', '11'].map((d) => iv(`2026-07-${d} 08:00`, `2026-07-${d} 17:00`));
    const a = calculatePay(base({ intervals }));
    const b = calculatePay(base({ intervals: intervals.map((x) => ({ ...x, breakMinutes: 0 })), rulePremiums: () => [] }));
    expect(b.lines).toEqual(a.lines);
    expect(b.grossWages.toString()).toBe(a.grossWages.toString());
    expect(a.grossWages.toNumber()).toBe(1220); // 40 × $20 + 14 h overtime × $30, unchanged
  });
});

describe('schedule change notice', () => {
  const notice = { postDaysAhead: 14, lateChangeHours: 48, premiumKind: 'multiplier' as const, multiplier: 1.5, flatAmount: 25 };
  const now = at('2026-07-06 09:00');
  it('a time change with less notice earns the extra half on the changed hours', () => {
    const r = changeNotice({ kind: 'TIME', old: iv('2026-07-07 08:00', '2026-07-07 16:00'), next: iv('2026-07-07 06:00', '2026-07-07 16:00'), now }, notice);
    expect(r).toMatchObject({ late: true, premiumHours: 2, multiplier: 1.5, noticeHours: 21 });
    expect(changePremiumAmount(r, 20)).toBe(20);
  });
  it('enough notice: nothing', () => {
    expect(changeNotice({ kind: 'TIME', old: iv('2026-07-10 08:00', '2026-07-10 16:00'), next: iv('2026-07-10 06:00', '2026-07-10 16:00'), now }, notice).late).toBe(false);
  });
  it('someone added late: the whole shift; removed: no multiplier premium; flat: per change', () => {
    expect(changeNotice({ kind: 'ADDED', old: null, next: iv('2026-07-07 08:00', '2026-07-07 16:00'), now }, notice).premiumHours).toBe(8);
    expect(changeNotice({ kind: 'REMOVED', old: iv('2026-07-07 08:00', '2026-07-07 16:00'), next: null, now }, notice)).toMatchObject({ late: true, premiumHours: 0, multiplier: null });
    const flat = changeNotice({ kind: 'REMOVED', old: iv('2026-07-07 08:00', '2026-07-07 16:00'), next: null, now }, { ...notice, premiumKind: 'flat' });
    expect(changePremiumAmount(flat, 20)).toBe(25);
  });
  it('off when the rule is off', () => {
    expect(changeNotice({ kind: 'ADDED', old: null, next: iv('2026-07-06 10:00', '2026-07-06 16:00'), now }, { ...notice, lateChangeHours: null }).late).toBe(false);
  });
});

describe('standby and call-back', () => {
  it('per day plus hours at a percent of the rate, clipped to the pay period', () => {
    const from = at('2026-07-05 00:00');
    const to = at('2026-07-12 00:00');
    const s = { perDay: 30, hoursPerDay: 1, percent: 50, callbackMinHours: 3, callbackMultiplier: 1.5 };
    // A week on call from Friday 08:00 to the next Friday 08:00: 2 days fall in this period… plus a part day.
    const r = standbyPay([{ start: at('2026-07-10 08:00'), end: at('2026-07-17 08:00') }], from, to, s, 40);
    expect(r.days).toBe(2);
    expect(r.amount).toBe(2 * 30 + 2 * 1 * 40 * 0.5);
    expect(standbyPay([{ start: at('2026-07-06 08:00'), end: at('2026-07-07 08:00') }], from, to, { ...s, perDay: null, hoursPerDay: null, percent: null }, 40).amount).toBe(0);
  });
  it('call-back minimum: the department’s, else the call-in minimum, else 3 hours', () => {
    expect(callbackMinimum({ perDay: null, hoursPerDay: null, percent: null, callbackMinHours: 4, callbackMultiplier: 1 }, { minHours: 3, source: 'province' })).toBe(4);
    expect(callbackMinimum({ perDay: null, hoursPerDay: null, percent: null, callbackMinHours: null, callbackMultiplier: 1 }, { minHours: 2, source: 'province' })).toBe(2);
    expect(callbackMinimum({ perDay: null, hoursPerDay: null, percent: null, callbackMinHours: null, callbackMultiplier: 1 }, null)).toBe(3);
  });
});

describe('two-person minimum', () => {
  const q = (u: string, p: string) => u !== 'helper' || p === 'any';
  const sh = (id: string, userId: string | null, s: string, e: string, neverAlone = false, positionId = 'entry', facilityId = 'f') => ({ id, userId, facilityId, positionId, start: at(s, TOR), end: at(e, TOR), neverAlone });
  it('flags stretches of a never-alone shift with no qualified second person', () => {
    const v = twoPersonViolations([sh('a', 'u1', '2026-07-06 08:00', '2026-07-06 16:00', true), sh('b', 'u2', '2026-07-06 08:00', '2026-07-06 12:00')], q);
    expect(v).toHaveLength(1);
    expect(v[0]!.aloneHours).toBe(4);
  });
  it('passes when covered the whole time; open shifts, other facilities and unqualified people don’t count', () => {
    expect(twoPersonViolations([sh('a', 'u1', '2026-07-06 08:00', '2026-07-06 16:00', true), sh('b', 'u2', '2026-07-06 07:00', '2026-07-06 17:00')], q)).toEqual([]);
    expect(twoPersonViolations([sh('a', 'u1', '2026-07-06 08:00', '2026-07-06 16:00', true), sh('b', null, '2026-07-06 08:00', '2026-07-06 16:00')], q)).toHaveLength(1);
    expect(twoPersonViolations([sh('a', 'u1', '2026-07-06 08:00', '2026-07-06 16:00', true), sh('b', 'u2', '2026-07-06 08:00', '2026-07-06 16:00', false, 'entry', 'g')], q)).toHaveLength(1);
    expect(twoPersonViolations([sh('a', 'u1', '2026-07-06 08:00', '2026-07-06 16:00', true), sh('b', 'helper', '2026-07-06 08:00', '2026-07-06 16:00')], q)).toHaveLength(1);
  });
  it('two never-alone shifts together satisfy each other', () => {
    expect(twoPersonViolations([sh('a', 'u1', '2026-07-06 08:00', '2026-07-06 16:00', true), sh('b', 'u2', '2026-07-06 08:00', '2026-07-06 16:00', true)], q)).toEqual([]);
  });
});
