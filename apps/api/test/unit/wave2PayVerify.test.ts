/**
 * Independent worked examples for scheduler wave 2 pay rules (expected values computed by hand,
 * shown in each comment). Rate $20/h unless stated; BC (Vancouver) unless stated.
 */
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { reportingPayRule, resolveRules } from '../../src/services/compliance/provincialRules.js';
import { type PayCalcInput, calculatePay } from '../../src/services/payroll/payCalc.js';
import { workRuleIntervals } from '../../src/services/payroll/workRulePay.js';
import { callbackMinimum, changeNotice, parseWorkRules, premiumPieces, reportingMinimum, standbyPay, type PremiumRule } from '../../src/services/scheduling/workRules.js';
import { TOR, VAN, at } from '../helpers.js';

const BC = resolveRules('BC', '2026-07-05');
const ON = resolveRules('ON', '2026-07-05');
const base = (over: Partial<PayCalcInput>): PayCalcInput => ({
  intervals: [],
  timezone: VAN,
  payWeekStartDay: 0,
  periodStart: '2026-07-05',
  weeks: 1,
  rules: BC,
  rateFor: () => new Decimal('20.00'),
  statHolidays: new Set(),
  completedYearsOfService: 0,
  vacationPayMode: 'ACCRUE',
  ...over,
});
const hrs = (r: { lines: Array<{ code: string; hours: Decimal }> }, code: string) => r.lines.filter((l) => l.code === code).reduce((s, l) => s.plus(l.hours), new Decimal(0)).toNumber();
const amt = (r: { lines: Array<{ code: string; amount: Decimal }> }, code: string) => r.lines.filter((l) => l.code === code).reduce((s, l) => s.plus(l.amount), new Decimal(0)).toNumber();

let n = 0;
function shift(start: string, end: string, o: { zone?: string; breakMin?: number | null; posBreak?: number | null; callBack?: boolean } = {}) {
  return { id: `s${++n}`, startsAt: at(start, o.zone), endsAt: at(end, o.zone), positionId: 'guard', status: 'PUBLISHED', callBack: o.callBack ?? false, premiumPerHour: null, unpaidBreakMinutes: o.breakMin ?? null, position: { unpaidBreakMinutes: o.posBreak ?? null } };
}
function punch(sh: ReturnType<typeof shift> | null, start: string, end: string, zone = VAN) {
  return { id: `p${++n}`, clockIn: at(start, zone), clockOut: at(end, zone), positionId: 'guard', shiftId: sh?.id ?? null, shift: sh };
}
const ctx = (rules = BC, stored: unknown = {}, timezone = VAN) => ({ rules, workRules: parseWorkRules(stored), deptOfPosition: new Map<string, string | null>([['guard', null]]), timezone });

describe('meal breaks in pay (worked examples)', () => {
  it('BC 08:00–16:30, 30 min planned, one punch: 8 h regular, no overtime', () => {
    const sh = shift('2026-07-06 08:00', '2026-07-06 16:30', { breakMin: 30 });
    const wr = workRuleIntervals([punch(sh, '2026-07-06 08:00', '2026-07-06 16:30')], ctx());
    const r = calculatePay(base({ intervals: wr.intervals }));
    expect(hrs(r, 'REGULAR')).toBe(8);
    expect(hrs(r, 'OVERTIME_1_5')).toBe(0);
    expect(r.grossWages.toNumber()).toBe(160);
  });
  it('lunch punched (two punches): paid as recorded, never deducted again', () => {
    const sh = shift('2026-07-06 08:00', '2026-07-06 16:30', { breakMin: 30 });
    const wr = workRuleIntervals([punch(sh, '2026-07-06 08:00', '2026-07-06 12:00'), punch(sh, '2026-07-06 12:30', '2026-07-06 16:30')], ctx());
    const r = calculatePay(base({ intervals: wr.intervals }));
    // 4 + 4 = 8 h, not 7.5.
    expect(hrs(r, 'REGULAR')).toBe(8);
  });
  it('one punch that ends before the planned break (12:00–12:30): nothing deducted', () => {
    const sh = shift('2026-07-06 08:00', '2026-07-06 16:30', { breakMin: 30 });
    const wr = workRuleIntervals([punch(sh, '2026-07-06 08:00', '2026-07-06 11:00')], ctx());
    expect(hrs(calculatePay(base({ intervals: wr.intervals })), 'REGULAR')).toBe(3);
  });
  it('one punch that only partly covers the planned break (left 12:10): not docked (the break wasn’t completed)', () => {
    const sh = shift('2026-07-06 08:00', '2026-07-06 16:30', { breakMin: 30 });
    const wr = workRuleIntervals([punch(sh, '2026-07-06 08:00', '2026-07-06 12:10')], ctx());
    // 08:00–12:10 = 4 h 10 min = 4.1667 h.
    expect(hrs(calculatePay(base({ intervals: wr.intervals })), 'REGULAR')).toBeCloseTo(4.1667, 3);
  });
  it('a position’s default break applies only on shifts over 5 h', () => {
    const short = shift('2026-07-06 08:00', '2026-07-06 13:00', { posBreak: 30 });
    const wr = workRuleIntervals([punch(short, '2026-07-06 08:00', '2026-07-06 13:00')], ctx());
    expect(hrs(calculatePay(base({ intervals: wr.intervals })), 'REGULAR')).toBe(5);
  });
  it('weekly overtime counts paid hours: ON 5 × 09:00–18:00 with 30 min = 42.5 h, under 44, no overtime', () => {
    const ps = ['06', '07', '08', '09', '10'].map((d) => punch(shift(`2026-07-${d} 09:00`, `2026-07-${d} 18:00`, { zone: TOR, breakMin: 30 }), `2026-07-${d} 09:00`, `2026-07-${d} 18:00`, TOR));
    const wr = workRuleIntervals(ps, ctx(ON, {}, TOR));
    const r = calculatePay(base({ timezone: TOR, rules: ON, intervals: wr.intervals }));
    expect(hrs(r, 'REGULAR')).toBe(42.5);
    expect(hrs(r, 'OVERTIME_1_5')).toBe(0);
  });
});

describe('call-in minimums (worked examples)', () => {
  it('ON: scheduled 09:00–17:00, sent home at 10:00 → 1 h worked + 2 h top-up = 3 h ($60)', () => {
    const sh = shift('2026-07-06 09:00', '2026-07-06 17:00', { zone: TOR, breakMin: 30 });
    const wr = workRuleIntervals([punch(sh, '2026-07-06 09:00', '2026-07-06 10:00', TOR)], ctx(ON, {}, TOR));
    expect(wr.topUps('2026-07-05', '2026-07-12')).toEqual([{ code: 'REPORTING_PAY', positionId: 'guard', hours: 2, multiplier: 1, localDate: '2026-07-06' }]);
  });
  it('BC: scheduled 8 paid hours (08:00–16:30 less 30 min) → 2 h minimum; scheduled 10 paid hours → 4 h', () => {
    const a = shift('2026-07-06 08:00', '2026-07-06 16:30', { breakMin: 30 });
    const b = shift('2026-07-07 07:00', '2026-07-07 17:30', { breakMin: 30 });
    const wr = workRuleIntervals([punch(a, '2026-07-06 08:00', '2026-07-06 09:00'), punch(b, '2026-07-07 07:00', '2026-07-07 08:30')], ctx());
    const t = wr.topUps('2026-07-05', '2026-07-12');
    expect(t.map((x) => [x.localDate, x.hours])).toEqual([
      ['2026-07-06', 1], // 2 − 1
      ['2026-07-07', 2.5], // 4 − 1.5
    ]);
  });
  it('worked the minimum or more: no top-up', () => {
    const sh = shift('2026-07-06 08:00', '2026-07-06 16:30', { breakMin: 30 });
    expect(workRuleIntervals([punch(sh, '2026-07-06 08:00', '2026-07-06 10:00')], ctx()).topUps('2026-07-05', '2026-07-12')).toEqual([]);
  });
  it('the organization can raise but never lower or switch off the statutory minimum', () => {
    const bc = reportingPayRule('BC');
    expect(reportingMinimum({ enabled: true, minHours: 1 }, bc, 8)?.minHours).toBe(2);
    expect(reportingMinimum({ enabled: true, minHours: 3 }, bc, 8)?.minHours).toBe(3);
    // Switching off the organization's own minimum leaves the law's.
    expect(reportingMinimum({ enabled: false, minHours: 3 }, bc, 8)?.minHours).toBe(2);
    expect(reportingMinimum({ enabled: false, minHours: 3 }, null, 8)).toBeNull();
  });
  it('a call-back is never paid less than the statutory call-in minimum (BC: 1 h agreement minimum → 2 h)', () => {
    const s = { perDay: null, hoursPerDay: null, percent: null, callbackMinHours: 1, callbackMultiplier: 1 };
    expect(callbackMinimum(s, reportingMinimum({ enabled: true, minHours: null }, reportingPayRule('BC'), 1))).toBe(2);
    expect(callbackMinimum({ ...s, callbackMinHours: 4 }, reportingMinimum({ enabled: true, minHours: null }, reportingPayRule('BC'), 1))).toBe(4);
  });
  it('a call-back: one top-up per call-back shift (two punches), at the call-back multiplier', () => {
    const cb = shift('2026-07-06 02:00', '2026-07-06 03:00', { callBack: true });
    const wr = workRuleIntervals([punch(cb, '2026-07-06 02:00', '2026-07-06 02:30'), punch(cb, '2026-07-06 02:40', '2026-07-06 03:00')], ctx(BC, { standby: { callbackMinHours: 3, callbackMultiplier: 1.5 } }));
    // Worked 50 min; 3 h minimum → top-up 2.17 h at 1.5×; no REPORTING_PAY besides.
    expect(wr.topUps('2026-07-05', '2026-07-12')).toEqual([{ code: 'CALLBACK_PAY', positionId: 'guard', hours: 2.17, multiplier: 1.5, localDate: '2026-07-06' }]);
  });
});

describe('standby (worked examples)', () => {
  const s = { perDay: 30, hoursPerDay: null, percent: null, callbackMinHours: 3, callbackMultiplier: 1 };
  it('a 7-day on-call week split across two pay periods is paid 7 days in all, not 8', () => {
    const p = [{ start: at('2026-07-10 08:00'), end: at('2026-07-17 08:00') }];
    const a = standbyPay(p, at('2026-07-05 00:00'), at('2026-07-12 00:00'), s, 40, VAN);
    const b = standbyPay(p, at('2026-07-12 00:00'), at('2026-07-19 00:00'), s, 40, VAN);
    // Days start Fri 10 and Sat 11 (period 1), Sun 12 … Thu 16 (period 2).
    expect([a.days, b.days]).toEqual([2, 5]);
    expect(a.amount + b.amount).toBe(210);
  });
  it('a week on call across the fall-back change (25-hour Sunday) is still 7 days', () => {
    const p = [{ start: at('2026-10-26 08:00', TOR), end: at('2026-11-02 08:00', TOR) }];
    expect(p[0]!.end.getTime() - p[0]!.start.getTime()).toBe(169 * 3_600_000);
    expect(standbyPay(p, at('2026-10-25 00:00', TOR), at('2026-11-08 00:00', TOR), s, 40, TOR).days).toBe(7);
  });
});

describe('change-notice premium (worked examples)', () => {
  const notice = { postDaysAhead: null, lateChangeHours: 72, premiumKind: 'multiplier' as const, multiplier: 1.5, flatAmount: 0 };
  it('09:00–17:00 extended to 09:00–19:00 a day ahead: 2 changed hours at the extra 0.5', () => {
    const r = changeNotice({ kind: 'TIME', old: { start: at('2026-07-07 09:00'), end: at('2026-07-07 17:00') }, next: { start: at('2026-07-07 09:00'), end: at('2026-07-07 19:00') }, now: at('2026-07-06 09:00') }, notice);
    expect(r).toMatchObject({ late: true, noticeHours: 24, premiumHours: 2, multiplier: 1.5 });
  });
  it('moved 09:00–17:00 → 13:00–21:00: only the 4 h outside the old shift', () => {
    const r = changeNotice({ kind: 'TIME', old: { start: at('2026-07-07 09:00'), end: at('2026-07-07 17:00') }, next: { start: at('2026-07-07 13:00'), end: at('2026-07-07 21:00') }, now: at('2026-07-06 09:00') }, notice);
    expect(r.premiumHours).toBe(4);
  });
});

describe('shift premiums (worked examples)', () => {
  const rule = (o: Partial<PremiumRule>): PremiumRule => ({ id: 'r', name: 'r', nameFr: null, kind: 'custom', days: [], startMinute: 0, endMinute: 1440, holidaysOnly: false, perHour: null, percent: null, departmentIds: [], positionIds: [], active: true, ...o });
  it('night 22:00–06:00 on a 20:00–04:00 shift with a 30 min break (23:45–00:15): 5.5 h × $2 = $11', () => {
    const night = rule({ id: 'n', startMinute: 1320, endMinute: 1800, perHour: 2 });
    const sh = shift('2026-07-06 20:00', '2026-07-07 04:00', { breakMin: 30 });
    const wr = workRuleIntervals([punch(sh, '2026-07-06 20:00', '2026-07-07 04:00')], ctx(BC, { premiums: [night] }));
    const r = calculatePay(base({ intervals: wr.intervals, rulePremiums: wr.rulePremiums(new Set()) }));
    expect(hrs(r, 'REGULAR')).toBe(7.5);
    expect(amt(r, 'SHIFT_PREMIUM')).toBe(11);
  });
  it('DST fall back: 22:00 Oct 31 – 06:00 Nov 1 is 9 real hours, all inside the night window (9 × $2 = $18)', () => {
    const night = rule({ id: 'n', startMinute: 1320, endMinute: 1800, perHour: 2 });
    const p = premiumPieces({ start: at('2026-10-31 22:00', TOR), end: at('2026-11-01 06:00', TOR) }, [night], { timezone: TOR, departmentId: null, positionId: 'guard', holidays: new Set() });
    expect(p[0]!.hours).toBe(9);
  });
  it('stacking: Saturday 18:00–23:00 evening $1.50 + weekend $1 → 5 × 2.50 = $12.50; 10 % of $20 = $2/h', () => {
    const ev = rule({ id: 'e', startMinute: 1080, endMinute: 1380, perHour: 1.5 });
    const we = rule({ id: 'w', days: [0, 6], perHour: 1 });
    const pc = rule({ id: 'p', percent: 10 });
    const r = calculatePay(base({ intervals: [{ start: at('2026-07-11 18:00'), end: at('2026-07-11 23:00'), positionId: 'guard' }], rulePremiums: (piece) => premiumPieces(piece, [ev, we, pc], { timezone: VAN, departmentId: null, positionId: 'guard', holidays: new Set() }) }));
    expect(amt(r, 'SHIFT_PREMIUM')).toBe(12.5 + 10);
  });
  it('premiums are not multiplied by overtime (BC 12 h day: 8 REG + 4 OT, $1/h on all 12 h = $12)', () => {
    const all = rule({ id: 'a', perHour: 1 });
    const r = calculatePay(base({ intervals: [{ start: at('2026-07-06 06:00'), end: at('2026-07-06 18:00'), positionId: 'guard' }], rulePremiums: (piece) => premiumPieces(piece, [all], { timezone: VAN, departmentId: null, positionId: 'guard', holidays: new Set() }) }));
    expect(hrs(r, 'OVERTIME_1_5')).toBe(4);
    expect(amt(r, 'SHIFT_PREMIUM')).toBe(12);
  });
});

describe('settings validation', () => {
  it('a premium window must end after it starts and last at most a day', async () => {
    const { workRulesBody } = await import('../../src/services/scheduling/workRules.js');
    const r = (startMinute: number, endMinute: number) => workRulesBody.safeParse({ premiums: [{ id: 'x', name: 'Night', kind: 'night', startMinute, endMinute, perHour: 1 }] }).success;
    expect(r(1320, 1800)).toBe(true); // 22:00–06:00
    expect(r(0, 1440)).toBe(true);
    expect(r(1320, 360)).toBe(false); // would pay nothing
    expect(r(0, 2880)).toBe(false); // would pay each hour twice
  });
  it('a rotation’s working days must fall inside its cycle', async () => {
    const { templateBody } = await import('../../src/services/scheduling/rotations.js');
    const t = (day: number) => templateBody.safeParse({ name: 'Plant', facilityId: '00000000-0000-4000-8000-000000000001', positionId: '00000000-0000-4000-8000-000000000002', cycleDays: 8, anchorDate: '2026-07-06', pattern: [{ day, start: '07:00', end: '19:00' }], crews: [{ name: 'A', offsetDays: 0 }] }).success;
    expect(t(7)).toBe(true);
    expect(t(8)).toBe(false);
  });
});
