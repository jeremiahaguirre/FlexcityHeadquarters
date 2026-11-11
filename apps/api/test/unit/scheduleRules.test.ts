/**
 * Regression tests for the independent scheduler review (P1/P2): Ontario daily rest, weekly rest,
 * the organization's limits on every path, overnight days in BC/AB, DST and availability past
 * midnight, and the personal weekly cap across pay weeks.
 */
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { federalRules, maxConsecutiveDaysAllowed, resolveRules } from '../../src/services/compliance/provincialRules.js';
import { workDayWindows } from '../../src/services/compliance/workDay.js';
import { calculatePay } from '../../src/services/payroll/payCalc.js';
import { type CandidateContext, type PositionSpec, type ShiftSpec, evaluateCandidate, isAvailable, projectOvertime, wallMinutes } from '../../src/services/scheduling/eligibility.js';
import { EDM, TOR, VAN, at, iv } from '../helpers.js';

const pos: PositionSpec = { id: 'guard', minimumAge: null, requiredCertIds: [], prerequisites: new Map() };
const shift = (s: string, e: string, zone = TOR): ShiftSpec => ({ id: 'x', positionId: 'guard', timezone: zone, start: at(s, zone), end: at(e, zone) });
const person = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  userId: 'u',
  status: 'ACTIVE',
  dateOfBirth: '1990-01-01',
  weeklyMaxHours: null,
  qualifiedPositionIds: new Set(['guard']),
  certExpiry: new Map(),
  existingShifts: [],
  approvedTimeOff: [],
  availability: [],
  ...over,
});
const opts = (prov: 'ON' | 'BC' | 'AB' | 'QC', extra: Record<string, unknown> = {}) => ({ rules: resolveRules(prov, '2026-11-01'), payWeekStartDay: 0, requireAvailability: false, ...extra });
const codes = (e: ReturnType<typeof evaluateCandidate>) => e.blocks.map((b) => b.code);

describe('Ontario daily rest: 11 h in every 24 h from a shift start (rest may cross midnight)', () => {
  for (const [a, b] of [['07:00', '15:00'], ['08:00', '16:00'], ['09:00', '17:00'], ['07:00', '19:00'], ['11:00', '19:00']]) {
    it(`passes an ordinary ${a}–${b} day shift`, () => {
      expect(codes(evaluateCandidate(person(), shift(`2026-11-10 ${a}`, `2026-11-10 ${b}`), pos, opts('ON')))).not.toContain('DAILY_REST');
    });
  }
  it('passes four 12-hour days and four 12-hour nights in a row', () => {
    const days = ['2026-11-09', '2026-11-10', '2026-11-11'].map((d) => iv(`${d} 07:00`, `${d} 19:00`, TOR));
    expect(codes(evaluateCandidate(person({ existingShifts: days }), shift('2026-11-12 07:00', '2026-11-12 19:00'), pos, opts('ON')))).not.toContain('DAILY_REST');
    const nights = [iv('2026-11-09 19:00', '2026-11-10 07:00', TOR), iv('2026-11-10 19:00', '2026-11-11 07:00', TOR)];
    expect(codes(evaluateCandidate(person({ existingShifts: nights }), shift('2026-11-11 19:00', '2026-11-12 07:00'), pos, opts('ON')))).not.toContain('DAILY_REST');
  });
  it('still refuses a genuine shortfall: 07–15 then 23–03 (8 h and 4 h off)', () => {
    const e = evaluateCandidate(person({ existingShifts: [iv('2026-11-10 07:00', '2026-11-10 15:00', TOR)] }), shift('2026-11-10 23:00', '2026-11-11 03:00'), pos, opts('ON'));
    expect(codes(e)).toContain('DAILY_REST');
  });
  it('refuses 06–14 and 20–24 (6 h and 6 h off)', () => {
    const e = evaluateCandidate(person({ existingShifts: [iv('2026-11-10 06:00', '2026-11-10 14:00', TOR)] }), shift('2026-11-10 20:00', '2026-11-11 00:00'), pos, opts('ON'));
    expect(codes(e)).toContain('DAILY_REST');
  });
});

describe('weekly rest', () => {
  it('BC: refuses the shift that leaves no 32 h off in the pay week (Sun–Fri 15–23, then Sat)', () => {
    const ex = ['01', '02', '03', '04', '05'].map((d) => iv(`2026-11-${d} 15:00`, `2026-11-${d} 23:00`, VAN));
    // Sun–Thu: Fri off and Sat off would be ~40 h; working Fri 15–23 leaves Fri 23 → Sun 00 = 25 h.
    const e = evaluateCandidate(person({ existingShifts: ex }), shift('2026-11-06 15:00', '2026-11-06 23:00', VAN), pos, opts('BC'));
    expect(codes(e)).toContain('WEEKLY_REST');
  });
  it('BC: Mon–Fri 9–5 every week is fine', () => {
    const ex = ['02', '03', '04', '05'].map((d) => iv(`2026-11-${d} 09:00`, `2026-11-${d} 17:00`, VAN));
    expect(codes(evaluateCandidate(person({ existingShifts: ex }), shift('2026-11-06 09:00', '2026-11-06 17:00', VAN), pos, opts('BC')))).not.toContain('WEEKLY_REST');
  });
  it('ON: seven short days in a pay week leave no 24 h off, and nothing in the two-week pair saves it', () => {
    // Pay weeks 2026-11-01 and 2026-11-08 are one pair; the second week is fully worked too.
    const ex = [...Array.from({ length: 13 }, (_, i) => i + 1)].map((n) => {
      const d = `2026-11-${String(n).padStart(2, '0')}`;
      return iv(`${d} 09:00`, `${d} 13:00`, TOR);
    });
    const e = evaluateCandidate(person({ existingShifts: ex }), shift('2026-11-14 09:00', '2026-11-14 13:00'), pos, opts('ON'));
    expect(codes(e)).toContain('WEEKLY_REST');
  });
  it('ON: no day off one week is allowed when the two-week pair has 48 h off in a row', () => {
    // Week of Nov 1 (Sun) worked every day 9–13; week of Nov 8 has Sun–Mon off (48 h+).
    const ex = ['01', '02', '03', '04', '05', '06'].map((d) => iv(`2026-11-${d} 09:00`, `2026-11-${d} 13:00`, TOR));
    const e = evaluateCandidate(person({ existingShifts: ex }), shift('2026-11-07 09:00', '2026-11-07 13:00'), pos, opts('ON'));
    expect(codes(e)).not.toContain('WEEKLY_REST');
  });
});

describe("the organization's limits, on every path", () => {
  const limits = { maxDailyHours: 12, maxConsecutiveDays: 6 };
  it('refuses a 16-hour overnight shift when the limit is 12 h a day (calendar provinces too)', () => {
    const e = evaluateCandidate(person(), shift('2026-11-03 16:00', '2026-11-04 08:00'), pos, opts('ON', { limits }));
    expect(codes(e)).toContain('DAILY_HOURS');
  });
  it('BC: counts the 24 hours from a shift past midnight as one day', () => {
    // 22:00–06:00 then 10:00–16:00 the next day: 14 h within 24 h of the first start.
    const e = evaluateCandidate(person({ existingShifts: [iv('2026-11-03 22:00', '2026-11-04 06:00', VAN)] }), shift('2026-11-04 14:00', '2026-11-04 20:00', VAN), pos, opts('BC', { limits: { maxDailyHours: 12, maxConsecutiveDays: null } }));
    expect(codes(e)).toContain('DAILY_HOURS');
  });
  it('refuses a seventh day in a row when the limit is 6', () => {
    const ex = ['02', '03', '04', '05', '06', '07'].map((d) => iv(`2026-11-${d} 09:00`, `2026-11-${d} 13:00`, VAN));
    expect(codes(evaluateCandidate(person({ existingShifts: ex }), shift('2026-11-08 09:00', '2026-11-08 13:00', VAN), pos, opts('BC', { limits })))).toContain('CONSECUTIVE_DAYS');
  });
  it('caps days in a row at what weekly rest allows (12)', () => {
    expect(maxConsecutiveDaysAllowed(resolveRules('ON', '2026-11-01'))).toBe(12);
  });
});

describe('daily overtime for shifts past midnight (BC/AB: the day is 24 h from the shift start)', () => {
  it('BC 16:00–08:00 is 8 regular, 4 at 1.5 and 4 at 2.0 in payroll', () => {
    const r = calculatePay({ intervals: [iv('2026-11-03 16:00', '2026-11-04 08:00', VAN)], timezone: VAN, payWeekStartDay: 0, periodStart: '2026-11-01', weeks: 1, rules: resolveRules('BC', '2026-11-01'), rateFor: () => new Decimal(20), statHolidays: new Set(), completedYearsOfService: 0, vacationPayMode: 'ACCRUE' });
    const h = (c: string) => r.lines.filter((l) => l.code === c).reduce((s, l) => s + l.hours.toNumber(), 0);
    expect([h('REGULAR'), h('OVERTIME_1_5'), h('OVERTIME_2_0')]).toEqual([8, 4, 4]);
  });
  it('the schedule projection agrees: BC 22:00–08:00 adds 2 h of overtime', () => {
    const p = projectOvertime([], { id: 'x', positionId: 'guard', timezone: VAN, start: at('2026-11-03 22:00'), end: at('2026-11-04 08:00') }, { rules: resolveRules('BC', '2026-11-01'), payWeekStartDay: 0 });
    expect(p.overtimeHours.toNumber()).toBe(2);
  });
  it('AB 22:00–08:00 is 2 h of daily overtime too', () => {
    const r = calculatePay({ intervals: [iv('2026-11-03 22:00', '2026-11-04 08:00', EDM)], timezone: EDM, payWeekStartDay: 0, periodStart: '2026-11-01', weeks: 1, rules: resolveRules('AB', '2026-11-01'), rateFor: () => new Decimal(20), statHolidays: new Set(), completedYearsOfService: 0, vacationPayMode: 'ACCRUE' });
    expect(r.lines.filter((l) => l.code === 'OVERTIME_1_5').reduce((s, l) => s + l.hours.toNumber(), 0)).toBe(2);
  });
  it('ON stays calendar-day (no daily overtime anyway); day shifts in BC are unchanged', () => {
    const w = workDayWindows([iv('2026-11-03 08:00', '2026-11-03 16:00', VAN)], VAN, 'shift_start_past_midnight');
    expect(w).toHaveLength(1);
    expect(w[0]!.date).toBe('2026-11-03');
  });
});

describe('DST and availability past midnight', () => {
  const avail = (dow: number, s: number, e: number) => ({ dayOfWeek: dow, startMinute: s, endMinute: e, effectiveFrom: '2026-01-01', effectiveTo: null });
  it('matches wall-clock minutes on the fall-back Sunday (Toronto, Nov 1 2026)', () => {
    const s = { start: at('2026-11-01 09:00', TOR), end: at('2026-11-01 17:00', TOR), timezone: TOR };
    expect(wallMinutes(s)).toEqual({ date: '2026-11-01', startMin: 540, endMin: 1020 });
    expect(isAvailable([avail(0, 540, 1020)], s)).toBe(true);
    expect(isAvailable([avail(0, 600, 1080)], s)).toBe(false);
  });
  it('matches wall-clock minutes on the spring-forward Sunday (Mar 14 2027)', () => {
    const s = { start: at('2027-03-14 09:00', TOR), end: at('2027-03-14 17:00', TOR), timezone: TOR };
    expect(isAvailable([avail(0, 540, 1020)], s)).toBe(true);
    expect(isAvailable([avail(0, 480, 960)], s)).toBe(false);
  });
  it("a shift after midnight fits the previous day's late window (Sat 22:00–06:00)", () => {
    expect(isAvailable([avail(6, 1320, 1800)], { start: at('2026-11-01 00:30', TOR), end: at('2026-11-01 05:30', TOR), timezone: TOR })).toBe(true);
    expect(isAvailable([avail(6, 1320, 1800)], { start: at('2026-10-31 22:00', TOR), end: at('2026-11-01 06:00', TOR), timezone: TOR })).toBe(true);
    expect(isAvailable([avail(6, 1320, 1800)], { start: at('2026-11-01 05:00', TOR), end: at('2026-11-01 07:00', TOR), timezone: TOR })).toBe(false);
  });
});

describe('personal weekly cap across pay weeks', () => {
  it('checks the second pay week of an overnight shift (Sat 22:00 → Sun 06:00)', () => {
    const ex = ['09', '10', '11', '12', '13'].map((d) => iv(`2026-11-${d} 08:00`, `2026-11-${d} 16:00`, VAN));
    const e = evaluateCandidate(person({ weeklyMaxHours: new Decimal(40), existingShifts: ex }), shift('2026-11-07 22:00', '2026-11-08 06:00', VAN), pos, opts('BC'));
    expect(codes(e)).toContain('OVER_PERSONAL_WEEKLY_MAX');
  });
});

describe('federal (Canada Labour Code) rule set', () => {
  it('is used when asked, with 8/40 overtime, 8 h rest and a day off a week', () => {
    const r = resolveRules('ON', '2026-11-01', [], { federal: true });
    expect(r.province).toBe('FED');
    expect(r.overtime).toMatchObject({ dailyHours: 8, weeklyHours: 40 });
    expect(r.rest).toMatchObject({ betweenShiftsHours: 8, weeklyConsecutiveHours: 24 });
    expect(federalRules().verified).toBe(false);
  });
});
