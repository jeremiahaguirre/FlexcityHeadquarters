/**
 * Time-to-wage calculation. Pure function — no database access — so it can be
 * unit tested exhaustively and re-run for any historical period.
 *
 * Fixes over the original sketch:
 *  - Hours are grouped into LOCAL work days (facility timezone) before daily OT,
 *    so split shifts on the same day accumulate, and overnight shifts are split.
 *  - Weekly OT is applied, using the province's method ('stacked' never double
 *    counts hours already paid as daily OT; 'greater_of' for Alberta).
 *  - Rates are per position and effective-dated (rateFor callback).
 *  - Decimal arithmetic throughout; amounts rounded per output line.
 *  - Periods must be whole pay weeks, so weekly OT is never computed on a
 *    partial week (punches that cross the period boundary are split, not dropped).
 *  - Statutory-holiday hours, shift premiums and vacation pay are separate lines.
 */
import type { PayCodeKey } from '@prisma/client';
import { Decimal, ZERO, cents, hoursDec } from '../../lib/money.js';
import { addDays, dayOfWeek, payWeekStart, splitByLocalDay, startOfLocalDay } from '../../lib/time.js';
import { type ProvinceRules, vacationPercent } from '../compliance/provincialRules.js';
import { workDayWindows } from '../compliance/workDay.js';
import { type Issue, issue } from './issues.js';

export interface WorkedInterval {
  start: Date;
  end: Date;
  positionId: string;
  /** Extra $/h (e.g. specialised class). Not multiplied by OT factors. */
  premiumPerHour?: Decimal | null;
}

export interface PayCalcInput {
  intervals: WorkedInterval[];
  timezone: string;
  payWeekStartDay: number;
  /** First local date of the period (must be a pay-week start). */
  periodStart: string;
  /** Number of whole pay weeks in the period (1 = weekly, 2 = bi-weekly). */
  weeks: number;
  rules: ProvinceRules;
  /** Hourly base rate for a position on a local date. */
  rateFor: (positionId: string, localDate: string) => Decimal;
  statHolidays: ReadonlySet<string>;
  completedYearsOfService: number;
  vacationPayMode: 'PAY_EACH_PERIOD' | 'ACCRUE';
}

export interface PayLine {
  code: PayCodeKey;
  positionId: string | null;
  hours: Decimal;
  rate: Decimal;
  multiplier: Decimal;
  amount: Decimal;
}

export interface PayResult {
  lines: PayLine[];
  totalHours: Decimal;
  grossWages: Decimal; // excludes vacation pay
  vacationPercent: number;
  vacationPay: Decimal; // paid this period
  vacationAccrued: Decimal; // banked, not paid
  /** Wages earned per local date (excluding vacation pay) — input to holiday-pay formulas. */
  dailyWages: Map<string, Decimal>;
  /** Hours worked per local date. */
  dailyHours: Map<string, Decimal>;
  warnings: Issue[];
}

type Bucket = 'REG' | 'OT15' | 'OT20';

interface Portion {
  start: Date;
  end: Date;
  hours: Decimal;
  localDate: string;
  /** The "day" for daily overtime (a calendar date, or a 24-hour day from a shift's start: workDay.ts). */
  workDay: string;
  positionId: string;
  premiumPerHour: Decimal | null;
  bucket: Bucket;
}

export function calculatePay(input: PayCalcInput): PayResult {
  const { rules, timezone } = input;
  const warnings: Issue[] = [];

  if (dayOfWeek(input.periodStart) !== input.payWeekStartDay) {
    throw new Error(`Period start ${input.periodStart} is not a pay-week start (day ${input.payWeekStartDay})`);
  }
  if (!Number.isInteger(input.weeks) || input.weeks < 1) throw new Error('weeks must be a positive integer');
  if (!rules.verified) {
    warnings.push(issue('RULES_UNVERIFIED', { province: rules.province }));
  }

  const periodEndDate = addDays(input.periodStart, input.weeks * 7);
  const periodStartInstant = startOfLocalDay(input.periodStart, timezone);
  const periodEndInstant = startOfLocalDay(periodEndDate, timezone);

  // 1. Clip to the period and split at local midnights (and, where a shift past midnight starts a
  //    24-hour day, at that day's boundaries: dailyOvertimeDays()).
  for (const iv of input.intervals) if (iv.end <= iv.start) throw new Error('Interval end must be after start');
  const days = dailyOvertimeDays(input.intervals, timezone, rules);
  const pieces: Array<Omit<Portion, 'bucket' | 'hours'>> = [];
  for (const iv of input.intervals) {
    const start = iv.start < periodStartInstant ? periodStartInstant : iv.start;
    const end = iv.end > periodEndInstant ? periodEndInstant : iv.end;
    if (end <= start) continue;
    for (const p of splitByLocalDay({ start, end }, timezone)) {
      for (const w of days ? days.filter((d) => d.start < p.end.getTime() && d.end > p.start.getTime()) : [null]) {
        const s2 = w ? new Date(Math.max(w.start, p.start.getTime())) : p.start;
        const e2 = w ? new Date(Math.min(w.end, p.end.getTime())) : p.end;
        if (e2 <= s2) continue;
        pieces.push({ start: s2, end: e2, localDate: p.localDate, workDay: w ? w.key : p.localDate, positionId: iv.positionId, premiumPerHour: iv.premiumPerHour ?? null });
      }
    }
  }
  pieces.sort((a, b) => a.start.getTime() - b.start.getTime());

  // 2. Daily classification.
  const byDay = groupBy(pieces, (p) => p.workDay);
  const portions: Portion[] = [];
  for (const day of [...byDay.keys()].sort()) {
    let dayHours = ZERO;
    for (const p of byDay.get(day)!) {
      for (const part of splitAtThresholds(p, dayHours, rules)) {
        portions.push(part);
        dayHours = dayHours.plus(part.hours);
      }
    }
  }

  // 3. Weekly classification, per pay week.
  const byWeek = groupBy(portions, (p) => payWeekStart(p.localDate, input.payWeekStartDay));
  const finalPortions: Portion[] = [];
  for (const week of [...byWeek.keys()].sort()) {
    finalPortions.push(...applyWeekly(byWeek.get(week)!, rules));
  }

  // 4. Money.
  const lineMap = new Map<string, PayLine>();
  const add = (code: PayCodeKey, positionId: string | null, hours: Decimal, rate: Decimal, multiplier: Decimal) => {
    const key = `${code}|${positionId}|${rate.toString()}|${multiplier.toString()}`;
    const existing = lineMap.get(key);
    if (existing) existing.hours = existing.hours.plus(hours);
    else lineMap.set(key, { code, positionId, hours, rate, multiplier, amount: ZERO });
  };

  const statMult = new Decimal(rules.statutoryHoliday.workedMultiplier);
  const dailyWages = new Map<string, Decimal>();
  const dailyHours = new Map<string, Decimal>();
  const bump = (m: Map<string, Decimal>, k: string, v: Decimal) => m.set(k, (m.get(k) ?? ZERO).plus(v));
  for (const p of finalPortions) {
    const rate = input.rateFor(p.positionId, p.localDate);
    const isStat = input.statHolidays.has(p.localDate);
    const mult = p.bucket === 'OT15' ? new Decimal(1.5) : p.bucket === 'OT20' ? new Decimal(2) : isStat ? statMult : new Decimal(1);
    bump(dailyWages, p.localDate, p.hours.mul(rate).mul(mult).plus(p.premiumPerHour ? p.hours.mul(p.premiumPerHour) : ZERO));
    bump(dailyHours, p.localDate, p.hours);
    if (p.bucket === 'REG') {
      if (isStat) add('STAT_WORKED', p.positionId, p.hours, rate, statMult);
      else add('REGULAR', p.positionId, p.hours, rate, new Decimal(1));
    } else if (p.bucket === 'OT15') {
      add('OVERTIME_1_5', p.positionId, p.hours, rate, new Decimal(1.5));
    } else {
      add('OVERTIME_2_0', p.positionId, p.hours, rate, new Decimal(2));
    }
    if (p.premiumPerHour && p.premiumPerHour.gt(0)) {
      add('SHIFT_PREMIUM', p.positionId, p.hours, p.premiumPerHour, new Decimal(1));
    }
  }
  if (finalPortions.some((p) => input.statHolidays.has(p.localDate)) && rules.statutoryHoliday.holidayPayFormula === null) {
    warnings.push(issue('STAT_PAY_MANUAL', { province: rules.province }));
  }

  const lines = [...lineMap.values()].map((l) => ({ ...l, amount: cents(l.hours.mul(l.rate).mul(l.multiplier)) }));
  const grossWages = lines.reduce((s, l) => s.plus(l.amount), ZERO);
  const totalHours = finalPortions.reduce((s, p) => s.plus(p.hours), ZERO);

  // 5. Vacation pay on gross wages.
  const pct = vacationPercent(rules, input.completedYearsOfService);
  const vacation = cents(grossWages.mul(pct).div(100));
  let vacationPay = ZERO;
  let vacationAccrued = ZERO;
  if (input.vacationPayMode === 'PAY_EACH_PERIOD') {
    vacationPay = vacation;
    if (vacation.gt(0)) {
      lines.push({ code: 'VACATION_PAY', positionId: null, hours: ZERO, rate: ZERO, multiplier: new Decimal(pct).div(100), amount: vacation });
    }
  } else {
    vacationAccrued = vacation;
  }

  return { lines, totalHours, grossWages, vacationPercent: pct, vacationPay, vacationAccrued, dailyWages, dailyHours, warnings };
}

/**
 * The days daily overtime is counted in, when they aren't plain calendar days: in BC and Alberta
 * (our reading, PENDING COUNSEL REVIEW, docs/COMPLIANCE.md) a shift that continues past midnight
 * starts a 24-hour day at its start, so a 16:00–08:00 shift is one 16-hour day (8 regular, then
 * overtime, then double time in BC) rather than 8 + 8 on two dates. Null = calendar days.
 */
export function dailyOvertimeDays(intervals: ReadonlyArray<{ start: Date; end: Date }>, timezone: string, rules: Pick<ProvinceRules, 'overtime'>) {
  if ((rules.overtime.dayDefinition ?? 'calendar') === 'calendar') return null;
  return workDayWindows(intervals, timezone, rules.overtime.dayDefinition);
}

/** Split one piece of a day into REG / OT15 / OT20 given hours already worked that day. */
function splitAtThresholds(
  piece: Omit<Portion, 'bucket' | 'hours'>,
  alreadyToday: Decimal,
  rules: ProvinceRules,
): Portion[] {
  const { dailyHours, dailyDoubleTimeHours } = rules.overtime;
  const boundaries: Array<{ at: Decimal; bucket: Bucket }> = [];
  if (dailyHours !== null) boundaries.push({ at: new Decimal(dailyHours), bucket: 'OT15' });
  if (dailyDoubleTimeHours !== null) boundaries.push({ at: new Decimal(dailyDoubleTimeHours), bucket: 'OT20' });

  const out: Portion[] = [];
  let cursor = piece.start;
  let worked = alreadyToday;
  const totalMs = piece.end.getTime();
  while (cursor.getTime() < totalMs) {
    let bucket: Bucket = 'REG';
    let nextBoundary: Decimal | null = null;
    for (const b of boundaries) {
      if (worked.gte(b.at)) bucket = b.bucket;
      else if (nextBoundary === null) nextBoundary = b.at;
    }
    let segEnd = piece.end;
    if (nextBoundary !== null) {
      const msToBoundary = nextBoundary.minus(worked).mul(3_600_000).toNumber();
      const candidate = new Date(cursor.getTime() + msToBoundary);
      if (candidate < segEnd) segEnd = candidate;
    }
    const hours = hoursDec(cursor, segEnd);
    out.push({ ...piece, start: cursor, end: segEnd, hours, bucket });
    worked = worked.plus(hours);
    cursor = segEnd;
  }
  return out;
}

function applyWeekly(week: Portion[], rules: ProvinceRules): Portion[] {
  const { weeklyHours, method } = rules.overtime;
  if (weeklyHours === null) return week;
  const threshold = new Decimal(weeklyHours);
  const sorted = [...week].sort((a, b) => a.start.getTime() - b.start.getTime());

  if (method === 'stacked') {
    // Only REG hours count toward the weekly threshold; REG beyond it becomes OT15.
    let regSoFar = ZERO;
    const out: Portion[] = [];
    for (const p of sorted) {
      if (p.bucket !== 'REG') {
        out.push(p);
        continue;
      }
      const room = Decimal.max(threshold.minus(regSoFar), ZERO);
      if (room.gte(p.hours)) {
        out.push(p);
        regSoFar = regSoFar.plus(p.hours);
      } else {
        const [a, b] = splitPortion(p, room);
        if (a) out.push(a);
        if (b) out.push({ ...b, bucket: 'OT15' });
        regSoFar = regSoFar.plus(room);
      }
    }
    return out;
  }

  // greater_of: compare daily-OT hours vs weekly-OT hours; pay whichever is greater.
  const total = sorted.reduce((s, p) => s.plus(p.hours), ZERO);
  const dailyOt = sorted.filter((p) => p.bucket !== 'REG').reduce((s, p) => s.plus(p.hours), ZERO);
  const weeklyOt = Decimal.max(total.minus(threshold), ZERO);
  if (weeklyOt.lte(dailyOt)) return sorted;
  // Weekly wins: the first `threshold` hours are REG, the remainder OT15.
  const out: Portion[] = [];
  let soFar = ZERO;
  for (const p of sorted) {
    const room = Decimal.max(threshold.minus(soFar), ZERO);
    if (room.gte(p.hours)) out.push({ ...p, bucket: 'REG' });
    else {
      const [a, b] = splitPortion(p, room);
      if (a) out.push({ ...a, bucket: 'REG' });
      if (b) out.push({ ...b, bucket: 'OT15' });
    }
    soFar = soFar.plus(p.hours);
  }
  return out;
}

function splitPortion(p: Portion, firstHours: Decimal): [Portion | null, Portion | null] {
  if (firstHours.lte(0)) return [null, p];
  if (firstHours.gte(p.hours)) return [p, null];
  const mid = new Date(p.start.getTime() + firstHours.mul(3_600_000).toNumber());
  return [
    { ...p, end: mid, hours: firstHours },
    { ...p, start: mid, hours: p.hours.minus(firstHours) },
  ];
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    const arr = m.get(k);
    if (arr) arr.push(i);
    else m.set(k, [i]);
  }
  return m;
}
