/**
 * Who may work a given shift — pure, deterministic, unit-tested.
 *
 * Replaces the original Prisma `findMany` sketch, which had four bugs:
 *  1. `certifications: { every }` passed users with NO certs and failed users
 *     with any unrelated cert. Here every required cert must be present (and
 *     its prerequisites current) through the shift's end date.
 *  2. The overlap test missed identical and fully-containing shifts. Here we use
 *     the half-open interval test `a.start < b.end && a.end > b.start`.
 *  3. Time off was compared by date equality. Here it is an interval overlap.
 *  4. Rest periods, availability and young-worker limits were never checked.
 *
 * The DB loader (eligibilityLoader.ts) does the coarse filtering in SQL; this
 * module makes the final decision with explanations for every rejection.
 */
import { DateTime } from 'luxon';
import { Decimal } from '../../lib/money.js';
import {
  type Interval,
  addDays,
  dayOfWeek,
  hoursBetween,
  localDate,
  mergeIntervals,
  overlaps,
  payWeekStart,
  startOfLocalDay,
  wholeYearsBetween,
} from '../../lib/time.js';
import { type Restriction, accommodationBlocks } from '../people/accommodation.js';
import { type ProvinceRules, maxConsecutiveDaysAllowed } from '../compliance/provincialRules.js';
import { hoursPerWorkDay } from '../compliance/workDay.js';
import { calculatePay } from '../payroll/payCalc.js';
import { paidIntervals } from './workRules.js';

export type BlockCode =
  | 'NOT_ACTIVE'
  | 'NOT_QUALIFIED_FOR_POSITION'
  | 'MISSING_CERTIFICATION'
  | 'CERTIFICATION_EXPIRES'
  | 'PREREQUISITE_LAPSED'
  | 'OVERLAPPING_SHIFT'
  | 'ON_APPROVED_TIME_OFF'
  | 'REST_BETWEEN_SHIFTS'
  | 'DAILY_REST'
  | 'UNDER_MINIMUM_AGE'
  | 'YOUNG_WORKER_LIMIT'
  | 'NOT_AVAILABLE'
  | 'OVER_PERSONAL_WEEKLY_MAX'
  | 'ONBOARDING_INCOMPLETE'
  | 'ACCOMMODATION'
  | 'HOS_DAILY'
  | 'HOS_REST'
  | 'HOS_WEEKLY'
  | 'DAILY_HOURS'
  | 'CONSECUTIVE_DAYS'
  | 'WEEKLY_REST';

export type FlagCode = 'OVERTIME' | 'PARENTAL_CONSENT_REQUIRED' | 'RULES_UNVERIFIED' | 'DATE_OF_BIRTH_MISSING';

export interface Reason<C extends string> {
  code: C;
  message: string;
}

export interface CandidateContext {
  userId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  dateOfBirth: string | null;
  weeklyMaxHours: Decimal | null;
  qualifiedPositionIds: ReadonlySet<string>;
  /** certificationId → latest expiry (null = never expires) */
  certExpiry: ReadonlyMap<string, string | null>;
  /** Assigned, non-cancelled shifts near the target shift. */
  existingShifts: Array<Interval & { positionId: string; facilityId?: string; id?: string; breakMinutes?: number | null; breakAfterHours?: number | null }>;
  approvedTimeOff: Interval[];
  /** Active work restrictions (accommodation / return to work). */
  restrictions?: Restriction[];
  /** Onboarding itemId → expiry of the latest completion (null = no expiry, or waived). */
  onboardingValid?: ReadonlyMap<string, string | null>;
  availability: Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}

export interface ShiftSpec extends Interval {
  id: string;
  positionId: string;
  timezone: string;
  /** Where it is (the scheduling assistant keeps travel time between facilities). */
  facilityId?: string;
  /** Unpaid meal break (minutes): out of paid hours, overtime and weekly hours. */
  breakMinutes?: number | null;
  /** Latest the break starts, hours into the shift (the province's rule or the organization's). */
  breakAfterHours?: number | null;
}

export interface PositionSpec {
  id: string;
  minimumAge: number | null;
  requiredCertIds: string[];
  /** certificationId → certification ids it depends on */
  prerequisites: ReadonlyMap<string, string[]>;
  /** Onboarding items that must be done (and unexpired) before working this position. */
  blockingOnboarding?: Array<{ id: string; name: string }>;
  /** Hours-of-service limits for driving positions. */
  hoursOfService?: HoursOfService | null;
}

export interface HoursOfService { maxDailyHours?: number | null; minRestHours?: number | null; maxHoursIn7Days?: number | null }

/** Reads a position's stored limits; anything missing or invalid means no limit. */
export function parseHoursOfService(stored: unknown): HoursOfService | null {
  if (!stored || typeof stored !== 'object') return null;
  const s = stored as Record<string, unknown>;
  const n = (k: string) => (typeof s[k] === 'number' && (s[k] as number) > 0 ? (s[k] as number) : null);
  const out = { maxDailyHours: n('maxDailyHours'), minRestHours: n('minRestHours'), maxHoursIn7Days: n('maxHoursIn7Days') };
  return out.maxDailyHours || out.minRestHours || out.maxHoursIn7Days ? out : null;
}

const hoursOf = (a: Interval) => (a.end.getTime() - a.start.getTime()) / 3_600_000;

/**
 * Driving limits, modelled on commercial vehicle hours-of-service rules
 * (e.g. 13 hours driving and 14 on duty a day, 8 hours off between shifts,
 * 70 hours in 7 days); each city sets its own numbers per position.
 */
export function checkHoursOfService(existing: Interval[], shift: Interval, hos: HoursOfService, tz: string): Reason<BlockCode>[] {
  const out: Reason<BlockCode>[] = [];
  if (hos.maxDailyHours) {
    const day = localDate(shift.start, tz);
    const total = [...existing.filter((s) => localDate(s.start, tz) === day), shift].reduce((sum, s) => sum + hoursOf(s), 0);
    if (total > hos.maxDailyHours + 1e-9) out.push({ code: 'HOS_DAILY', message: `Would be ${total.toFixed(1)}h on duty that day (limit ${hos.maxDailyHours}h).` });
  }
  if (hos.minRestHours) {
    const gapMs = hos.minRestHours * 3_600_000;
    const tooClose = existing.some((s) => (s.end <= shift.start && shift.start.getTime() - s.end.getTime() < gapMs) || (s.start >= shift.end && s.start.getTime() - shift.end.getTime() < gapMs));
    if (tooClose) out.push({ code: 'HOS_REST', message: `Needs ${hos.minRestHours}h off duty between driving shifts.` });
  }
  if (hos.maxHoursIn7Days) {
    const from = shift.end.getTime() - 7 * 86_400_000;
    const total = [...existing, shift].reduce((sum, s) => sum + Math.max(0, (Math.min(s.end.getTime(), shift.end.getTime()) - Math.max(s.start.getTime(), from)) / 3_600_000), 0);
    if (total > hos.maxHoursIn7Days + 1e-9) out.push({ code: 'HOS_WEEKLY', message: `Would be ${total.toFixed(1)}h in 7 days (limit ${hos.maxHoursIn7Days}h).` });
  }
  return out;
}

export interface SchoolCalendar {
  isSchoolDay(isoDate: string): boolean;
  /** Local school hours on a school day, minutes after midnight. */
  schoolHours: { startMinute: number; endMinute: number };
}

/** Default: weekdays from Sept 1 to June 30. Tenants should configure real calendars. */
export const DEFAULT_SCHOOL_CALENDAR: SchoolCalendar = {
  isSchoolDay(iso) {
    const d = DateTime.fromISO(iso);
    const weekday = d.weekday <= 5;
    const inYear = d.month >= 9 || d.month <= 6;
    return weekday && inYear;
  },
  schoolHours: { startMinute: 8 * 60 + 30, endMinute: 15 * 60 + 30 },
};

export interface EvaluateOptions {
  rules: ProvinceRules;
  payWeekStartDay: number;
  /** Assistant-generated schedules require availability; voluntary claims do not. */
  requireAvailability: boolean;
  schoolCalendar?: SchoolCalendar;
  /**
   * Batch callers (the planner's eligibility grid) pass one per person: the overtime already in
   * the person's other shifts is computed once per pay period instead of once per shift checked.
   */
  overtimeMemo?: OvertimeMemo;
  /**
   * The organization's (or department's) own limits, enforced on every path: manual assign, the
   * Shift Board, Fill, the planner, trades and call-outs. Omitted = not enforced (unit tests).
   */
  limits?: OrgLimits | null;
}

export interface OrgLimits {
  /** Most hours a person may work in a day: the shift itself, and everything in the day it falls in. */
  maxDailyHours: number | null;
  /** Most days in a row with a shift starting (capped by what weekly rest allows). */
  maxConsecutiveDays: number | null;
}

/** Overtime hours of a set of existing shifts, per rules in force. */
export type OvertimeMemo = WeakMap<ProvinceRules, Map<string, Decimal>>;

export interface Evaluation {
  userId: string;
  eligible: boolean;
  blocks: Reason<BlockCode>[];
  flags: Reason<FlagCode>[];
  /** Additional overtime hours this shift would cause (0 if none). */
  overtimeHours: Decimal;
  weeklyHoursAfter: Decimal;
}

export function evaluateCandidate(
  c: CandidateContext,
  shift: ShiftSpec,
  position: PositionSpec,
  opts: EvaluateOptions,
): Evaluation {
  const blocks: Reason<BlockCode>[] = [];
  const flags: Reason<FlagCode>[] = [];
  const { rules } = opts;
  const tz = shift.timezone;
  const shiftEndDate = localDate(new Date(shift.end.getTime() - 1), tz);
  const shiftStartDate = localDate(shift.start, tz);

  if (!rules.verified) flags.push({ code: 'RULES_UNVERIFIED', message: `${rules.province} rules pending legal review.` });
  if (c.status !== 'ACTIVE') blocks.push({ code: 'NOT_ACTIVE', message: `Staff status is ${c.status}.` });

  // Position and certifications ------------------------------------------------
  if (!c.qualifiedPositionIds.has(shift.positionId)) {
    blocks.push({ code: 'NOT_QUALIFIED_FOR_POSITION', message: 'Not approved to work this position.' });
  }
  const certValidThrough = (certId: string): boolean => {
    if (!c.certExpiry.has(certId)) return false;
    const exp = c.certExpiry.get(certId) ?? null;
    return exp === null || exp >= shiftEndDate;
  };
  for (const item of position.blockingOnboarding ?? []) {
    const exp = c.onboardingValid?.get(item.id);
    if (exp === undefined) blocks.push({ code: 'ONBOARDING_INCOMPLETE', message: `Onboarding not done: ${item.name}.` });
    else if (exp !== null && exp < shiftEndDate) blocks.push({ code: 'ONBOARDING_INCOMPLETE', message: `Onboarding expires before the shift: ${item.name}.` });
  }
  for (const certId of position.requiredCertIds) {
    if (!c.certExpiry.has(certId)) {
      blocks.push({ code: 'MISSING_CERTIFICATION', message: `Missing required certification ${certId}.` });
      continue;
    }
    if (!certValidThrough(certId)) {
      blocks.push({ code: 'CERTIFICATION_EXPIRES', message: `Certification ${certId} expires before the shift ends.` });
    }
    for (const pre of position.prerequisites.get(certId) ?? []) {
      if (!certValidThrough(pre)) {
        blocks.push({ code: 'PREREQUISITE_LAPSED', message: `Certification ${certId} requires current ${pre}.` });
      }
    }
  }

  // Conflicts ------------------------------------------------------------------
  if (c.existingShifts.some((s) => overlaps(s, shift))) {
    blocks.push({ code: 'OVERLAPPING_SHIFT', message: 'Already scheduled during this time.' });
  }
  if (c.approvedTimeOff.some((t) => overlaps(t, shift))) {
    blocks.push({ code: 'ON_APPROVED_TIME_OFF', message: 'Has approved time off during this shift.' });
  }

  // Hours of service (driving positions) ----------------------------------------
  if (position.hoursOfService) blocks.push(...checkHoursOfService(c.existingShifts, shift, position.hoursOfService, tz));

  // Rest periods ---------------------------------------------------------------
  const restBlock = checkRestBetweenShifts(c.existingShifts, shift, rules);
  if (restBlock) blocks.push(restBlock);
  const dailyRest = checkDailyRest(c.existingShifts, shift, rules);
  if (dailyRest) blocks.push(dailyRest);
  const weeklyRest = checkWeeklyRest(c.existingShifts, shift, rules, tz, opts.payWeekStartDay);
  if (weeklyRest) blocks.push(weeklyRest);
  if (opts.limits) blocks.push(...checkOrgLimits(c.existingShifts, shift, rules, opts.limits));

  // Age -------------------------------------------------------------------------
  if (c.dateOfBirth === null) {
    flags.push({ code: 'DATE_OF_BIRTH_MISSING', message: 'Date of birth not on file; young-worker rules not checked.' });
  } else {
    const age = wholeYearsBetween(c.dateOfBirth, shiftStartDate);
    const minAge = Math.max(position.minimumAge ?? 0, rules.youngWorkers.minimumAge);
    if (age < minAge) {
      blocks.push({ code: 'UNDER_MINIMUM_AGE', message: `Age ${age} is below the minimum of ${minAge}.` });
    }
    if (rules.youngWorkers.parentalConsentUnder !== null && age < rules.youngWorkers.parentalConsentUnder) {
      flags.push({ code: 'PARENTAL_CONSENT_REQUIRED', message: 'Parental consent must be on file.' });
    }
    blocks.push(...checkYoungWorkerLimits(age, c.existingShifts, shift, rules, opts));
  }

  // Availability ---------------------------------------------------------------
  if (opts.requireAvailability && !isAvailable(c.availability, shift)) {
    blocks.push({ code: 'NOT_AVAILABLE', message: 'Outside submitted availability.' });
  }

  // Hours & overtime -----------------------------------------------------------
  const { overtimeHours, weeklyHoursAfter, weeks } = projectOvertime(c.existingShifts, shift, opts);
  // Every pay week the shift touches (an overnight shift can cross into the next one).
  const busiest = weeks.reduce((m, w) => (w.hours.gt(m.hours) ? w : m), weeks[0]!);
  if (c.weeklyMaxHours !== null && busiest.hours.gt(c.weeklyMaxHours)) {
    blocks.push({
      code: 'OVER_PERSONAL_WEEKLY_MAX',
      message: `Would reach ${busiest.hours.toFixed(2)}h in the week of ${busiest.weekStart} (cap ${c.weeklyMaxHours.toFixed(2)}h).`,
    });
  }
  for (const message of accommodationBlocks(c.restrictions ?? [], { start: shift.start, end: shift.end, positionId: shift.positionId, timezone: tz }, busiest.hours)) {
    blocks.push({ code: 'ACCOMMODATION', message });
  }
  if (overtimeHours.gt(0)) {
    flags.push({ code: 'OVERTIME', message: `Adds ${overtimeHours.toFixed(2)}h of overtime.` });
  }

  return { userId: c.userId, eligible: blocks.length === 0, blocks, flags, overtimeHours, weeklyHoursAfter };
}

export function checkRestBetweenShifts(existing: Interval[], shift: Interval, rules: ProvinceRules): Reason<BlockCode> | null {
  const min = rules.rest.betweenShiftsHours;
  if (min === null) return null;
  for (const s of existing) {
    if (overlaps(s, shift)) continue; // reported separately
    const [first, second] = s.end <= shift.start ? [s, shift] : [shift, s];
    const gap = hoursBetween(first.end, second.start);
    if (gap >= min) continue;
    const span = hoursBetween(first.start, second.end);
    const worked = hoursBetween(first.start, first.end) + hoursBetween(second.start, second.end);
    if (rules.rest.splitShiftMaxSpanHours != null && span <= rules.rest.splitShiftMaxSpanHours) continue;
    if (rules.rest.betweenShiftsExemptIfWorkedAtMost != null && worked <= rules.rest.betweenShiftsExemptIfWorkedAtMost) continue;
    return {
      code: 'REST_BETWEEN_SHIFTS',
      message: `Only ${gap.toFixed(1)}h between shifts (${min}h required).`,
    };
  }
  return null;
}

const DAY_MS = 86_400_000;
const H_MS = 3_600_000;

/** Longest stretch with no work inside [from, to), in hours. */
export function longestFree(busy: ReadonlyArray<{ start: number; end: number }>, from: number, to: number): number {
  const parts = busy
    .filter((b) => b.start < to && b.end > from)
    .map((b) => [Math.max(b.start, from), Math.min(b.end, to)] as const)
    .sort((a, b) => a[0] - b[0]);
  let longest = 0;
  let cursor = from;
  for (const [a, b] of parts) {
    longest = Math.max(longest, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return Math.max(longest, to - cursor) / H_MS;
}

const ms = (xs: ReadonlyArray<Interval>) => xs.map((x) => ({ start: x.start.getTime(), end: x.end.getTime() }));

/**
 * Daily rest (ON: 11 consecutive hours off in each day). Our reading, pending counsel review
 * (docs/COMPLIANCE.md): every 24 hours that start at the start of a shift must hold that many
 * consecutive hours off, and the rest may cross midnight, so ordinary day shifts (09–17, 07–19)
 * and nights (19–07) pass, while 07–15 then 23–03 (8 h and 4 h off) does not. Refuses only when
 * this shift makes a 24-hour period short of rest (an existing shortfall isn't blamed on it).
 */
export function checkDailyRest(existing: ReadonlyArray<Interval>, shift: Interval, rules: ProvinceRules): Reason<BlockCode> | null {
  const required = rules.rest.dailyConsecutiveHours;
  if (required === null) return null;
  const before = ms(existing.filter((s) => !overlaps(s, shift)));
  const after = [...before, { start: shift.start.getTime(), end: shift.end.getTime() }];
  const a = shift.start.getTime();
  const b = shift.end.getTime();
  // 24-hour periods that can contain this shift: those starting at a shift start in (start − 24 h, end).
  const starts = after.map((x) => x.start).filter((t) => t > a - DAY_MS && t < b);
  for (const t of [...new Set(starts)].sort((x, y) => x - y)) {
    const free = longestFree(after, t, t + DAY_MS);
    if (free + 1e-9 >= required) continue;
    const had = t === a ? 24 : longestFree(before, t, t + DAY_MS);
    if (free < had - 1e-9) return { code: 'DAILY_REST', message: `Would leave only ${free.toFixed(1)}h consecutive rest (${required}h required in each day, counted from a shift start).` };
  }
  return null;
}

/**
 * Weekly rest: the longest consecutive time off inside each pay week the shift touches must be
 * at least the province's hours (BC 32, QC 32, ON/AB and most others 24). Ontario also allows 48
 * consecutive hours in each period of two consecutive work weeks (pairs counted from a fixed
 * week). With 'rolling7', every 7 days ending in the shift are checked instead. Refuses only when
 * this shift creates or worsens the shortfall.
 */
export function checkWeeklyRest(existing: ReadonlyArray<Interval>, shift: Interval, rules: ProvinceRules, tz: string, payWeekStartDay: number): Reason<BlockCode> | null {
  const required = rules.rest.weeklyConsecutiveHours;
  if (!required) return null;
  const before = ms(existing.filter((s) => !overlaps(s, shift)));
  const after = [...before, { start: shift.start.getTime(), end: shift.end.getTime() }];
  const fail = (hours: number) => ({ code: 'WEEKLY_REST' as const, message: `Would leave only ${hours.toFixed(1)}h off in a row that week (${required}h required).` });
  if (rules.rest.weeklyRestPeriod === 'rolling7') {
    for (let t = shift.start.getTime() - 7 * DAY_MS + H_MS; t <= shift.end.getTime(); t += H_MS) {
      const free = longestFree(after, t, t + 7 * DAY_MS);
      if (free + 1e-9 < required && free < longestFree(before, t, t + 7 * DAY_MS) - 1e-9) return fail(free);
    }
    return null;
  }
  const weekBounds = (w: string) => [startOfLocalDay(w, tz).getTime(), startOfLocalDay(addDays(w, 7), tz).getTime()] as const;
  const touched = [...new Set([payWeekStart(localDate(shift.start, tz), payWeekStartDay), payWeekStart(localDate(new Date(shift.end.getTime() - 1), tz), payWeekStartDay)])];
  const two = rules.rest.weeklyRestTwoWeekHours ?? null;
  // Fixed pairs of weeks (ON's two-week alternative): pair index from a fixed Sunday.
  const pairStart = (w: string) => {
    const n = Math.round((Date.parse(`${w}T12:00:00Z`) - Date.parse('2000-01-02T12:00:00Z')) / (7 * DAY_MS));
    return n % 2 === 0 ? w : addDays(w, -7);
  };
  const ok = (busy: typeof after, w: string) => {
    const [ws, we] = weekBounds(w);
    const free = longestFree(busy, ws, we);
    if (free + 1e-9 >= required) return { ok: true, free };
    if (two) {
      const p = pairStart(w);
      const [ps] = weekBounds(p);
      const [, pe] = weekBounds(addDays(p, 7));
      if (longestFree(busy, ps, pe) + 1e-9 >= two) return { ok: true, free };
    }
    return { ok: false, free };
  };
  // With the two-week alternative, the other week of the pair can change too.
  const weeks = two ? [...new Set(touched.flatMap((w) => [pairStart(w), addDays(pairStart(w), 7)]))] : touched;
  for (const w of weeks) {
    const now = ok(after, w);
    if (now.ok) continue;
    const was = ok(before, w);
    if (was.ok || now.free < was.free - 1e-9) return fail(now.free);
  }
  return null;
}

/**
 * The organization's limits: a shift may not be longer than the max hours a day, nor bring the
 * day it falls in over it (a calendar day, or in BC/AB the 24 hours from the start of a shift past
 * midnight: workDay.ts); and no more than the max days in a row with a shift starting (capped by
 * what weekly rest allows).
 */
export function checkOrgLimits(existing: ReadonlyArray<Interval>, shift: ShiftSpec, rules: ProvinceRules, limits: OrgLimits): Reason<BlockCode>[] {
  const out: Reason<BlockCode>[] = [];
  const tz = shift.timezone;
  const others = existing.filter((s) => !overlaps(s, shift));
  const max = limits.maxDailyHours;
  if (max) {
    const len = hoursOf(shift);
    if (len > max + 1e-9) out.push({ code: 'DAILY_HOURS', message: `This shift is ${len.toFixed(1)}h (limit ${max}h a day).` });
    else {
      const days = hoursPerWorkDay([...others, shift], tz, rules.overtime.dayDefinition ?? 'calendar');
      const over = days.find((d) => d.start < shift.end.getTime() && d.end > shift.start.getTime() && d.hours > max + 1e-9);
      if (over) out.push({ code: 'DAILY_HOURS', message: `Would be ${over.hours.toFixed(1)}h on ${over.date} (limit ${max}h a day).` });
    }
  }
  if (limits.maxConsecutiveDays) {
    const cap = Math.min(limits.maxConsecutiveDays, maxConsecutiveDaysAllowed(rules));
    const run = consecutiveDays([...others, shift], shift, tz);
    if (run > cap) out.push({ code: 'CONSECUTIVE_DAYS', message: `Would be ${run} days in a row (limit ${cap}).` });
  }
  return out;
}

/** Days in a row with a shift starting, through the day this shift starts (each shift counts on its start date). */
export function consecutiveDays(all: ReadonlyArray<Interval>, shift: Interval, tz: string): number {
  const worked = new Set(all.map((s) => localDate(s.start, tz)));
  const d0 = localDate(shift.start, tz);
  let run = 1;
  for (let d = addDays(d0, -1); worked.has(d); d = addDays(d, -1)) run++;
  for (let d = addDays(d0, 1); worked.has(d); d = addDays(d, 1)) run++;
  return run;
}

function checkYoungWorkerLimits(
  age: number,
  existing: Interval[],
  shift: ShiftSpec,
  rules: ProvinceRules,
  opts: EvaluateOptions,
): Reason<BlockCode>[] {
  const out: Reason<BlockCode>[] = [];
  const cal = opts.schoolCalendar ?? DEFAULT_SCHOOL_CALENDAR;
  const tz = shift.timezone;
  const day = localDate(shift.start, tz);
  const weekStart = payWeekStart(day, opts.payWeekStartDay);
  const weekEnd = addDays(weekStart, 7);
  const all = [...existing, shift];

  const hoursOnDay = sumHoursWithin(all, startOfLocalDay(day, tz), startOfLocalDay(addDays(day, 1), tz));
  const hoursInWeek = sumHoursWithin(all, startOfLocalDay(weekStart, tz), startOfLocalDay(weekEnd, tz));
  const schoolDay = cal.isSchoolDay(day);
  let weekHasSchool = false;
  for (let d = weekStart; d < weekEnd; d = addDays(d, 1)) if (cal.isSchoolDay(d)) weekHasSchool = true;

  for (const lim of rules.youngWorkers.limits) {
    if (age >= lim.underAge) continue;
    const label = `Under ${lim.underAge}:`;
    const dayMax = schoolDay ? lim.schoolDayMaxHours : lim.nonSchoolDayMaxHours;
    const weekMax = weekHasSchool ? lim.schoolWeekMaxHours : lim.nonSchoolWeekMaxHours;
    if (dayMax !== undefined && hoursOnDay > dayMax) {
      out.push({ code: 'YOUNG_WORKER_LIMIT', message: `${label} ${hoursOnDay.toFixed(1)}h on ${day} exceeds ${dayMax}h.` });
    }
    if (weekMax !== undefined && hoursInWeek > weekMax) {
      out.push({ code: 'YOUNG_WORKER_LIMIT', message: `${label} ${hoursInWeek.toFixed(1)}h this week exceeds ${weekMax}h.` });
    }
    if (lim.noWorkDuringSchoolHours && schoolDay) {
      const school = { start: wallClock(day, cal.schoolHours.startMinute, tz), end: wallClock(day, cal.schoolHours.endMinute, tz) };
      if (overlaps(shift, school)) {
        out.push({ code: 'YOUNG_WORKER_LIMIT', message: `${label} may not work during school hours.` });
      }
    }
    if (lim.latestEnd) {
      const [h, m] = lim.latestEnd.split(':').map(Number) as [number, number];
      const latest = DateTime.fromISO(day, { zone: tz }).set({ hour: h, minute: m }).toJSDate();
      if (shift.end > latest) {
        out.push({ code: 'YOUNG_WORKER_LIMIT', message: `${label} may not work past ${lim.latestEnd}.` });
      }
    }
  }
  return out;
}

function sumHoursWithin(intervals: Interval[], from: Date, to: Date): number {
  return mergeIntervals(intervals).reduce((sum, i) => {
    const s = i.start < from ? from : i.start;
    const e = i.end > to ? to : i.end;
    return e > s ? sum + hoursBetween(s, e) : sum;
  }, 0);
}

/** The instant of a wall-clock time (minutes after midnight; past 1440 runs into the next day) on a local date (DST-correct). */
export function wallClock(isoDate: string, minute: number, tz: string): Date {
  const extra = Math.floor(minute / 1440);
  const m = minute - extra * 1440;
  return DateTime.fromISO(addDays(isoDate, extra), { zone: tz }).set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 }).toJSDate();
}

/**
 * A shift in wall-clock minutes from its start date's midnight (09:00–17:00 is 540–1020 on a DST
 * changeover day too; 22:00–06:00 is 1320–1800).
 */
export function wallMinutes(shift: Pick<ShiftSpec, 'start' | 'end' | 'timezone'>): { date: string; startMin: number; endMin: number } {
  const s = DateTime.fromJSDate(shift.start, { zone: shift.timezone });
  const e = DateTime.fromJSDate(shift.end, { zone: shift.timezone });
  const date = s.toISODate()!;
  const days = Math.round((Date.parse(`${e.toISODate()}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / DAY_MS);
  return { date, startMin: s.hour * 60 + s.minute, endMin: days * 1440 + e.hour * 60 + e.minute };
}

/**
 * Inside submitted availability (a hard rule for generated schedules, a warning for manual ones).
 * Wall-clock minutes, so DST days work; a window may run past midnight (endMinute > 1440), and a
 * shift starting after midnight is also matched against the previous day's late window.
 */
export function availableAt(windows: CandidateContext['availability'], date: string, startMin: number, endMin: number): boolean {
  const fits = (d: string, offset: number) => {
    const dow = dayOfWeek(d);
    return windows.some((w) => w.dayOfWeek === dow && w.effectiveFrom <= d && (w.effectiveTo === null || w.effectiveTo >= d) && w.startMinute <= startMin + offset && w.endMinute >= endMin + offset);
  };
  return fits(date, 0) || fits(addDays(date, -1), 1440);
}

export function isAvailable(windows: CandidateContext['availability'], shift: Pick<ShiftSpec, 'start' | 'end' | 'timezone'>): boolean {
  const w = wallMinutes(shift);
  return availableAt(windows, w.date, w.startMin, w.endMin);
}

/**
 * Overtime this shift would ADD, computed with the same engine as payroll so the
 * Shift Board warning and the pay stub can never disagree.
 */
export function projectOvertime(
  existing: Array<Interval & { positionId: string; breakMinutes?: number | null; breakAfterHours?: number | null }>,
  shift: ShiftSpec,
  opts: Pick<EvaluateOptions, 'rules' | 'payWeekStartDay' | 'overtimeMemo'>,
): { overtimeHours: Decimal; weeklyHoursAfter: Decimal; weeks: Array<{ weekStart: string; hours: Decimal }> } {
  const tz = shift.timezone;
  const periodStart = payWeekStart(localDate(shift.start, tz), opts.payWeekStartDay);
  const lastWeek = payWeekStart(localDate(new Date(shift.end.getTime() - 1), tz), opts.payWeekStartDay);
  const weeks = lastWeek === periodStart ? 1 : 2;
  const run = (intervals: Array<Interval & { positionId: string; breakMinutes?: number | null }>) =>
    calculatePay({
      intervals,
      timezone: tz,
      payWeekStartDay: opts.payWeekStartDay,
      periodStart,
      weeks,
      rules: { ...opts.rules, verified: true },
      rateFor: () => new Decimal(1),
      statHolidays: new Set(),
      completedYearsOfService: 0,
      vacationPayMode: 'ACCRUE',
    });
  const otOf = (r: ReturnType<typeof run>) =>
    r.lines.filter((l) => l.code === 'OVERTIME_1_5' || l.code === 'OVERTIME_2_0').reduce((s, l) => s.plus(l.hours), new Decimal(0));
  const nonOverlapping = existing.filter((s) => !overlaps(s, shift));
  let beforeOt: Decimal;
  const memo = opts.overtimeMemo;
  if (memo) {
    const byRules = memo.get(opts.rules) ?? new Map<string, Decimal>();
    memo.set(opts.rules, byRules);
    const key = `${periodStart}|${weeks}|${tz}|${nonOverlapping.map((s) => `${s.start.getTime()}-${s.end.getTime()}-${s.positionId}-${s.breakMinutes ?? 0}`).sort().join(',')}`;
    beforeOt = byRules.get(key) ?? otOf(run(nonOverlapping));
    byRules.set(key, beforeOt);
  } else beforeOt = otOf(run(nonOverlapping));
  const after = run([...nonOverlapping, shift]);

  // Weekly hours are paid hours: unpaid meal breaks don't count.
  const all = [...nonOverlapping, shift].flatMap((x) => paidIntervals(x));
  const weekList = weeks === 1 ? [periodStart] : [periodStart, lastWeek];
  const perWeek = weekList.map((w) => ({ weekStart: w, hours: new Decimal(sumHoursWithin(all, startOfLocalDay(w, tz), startOfLocalDay(addDays(w, 7), tz))) }));
  return { overtimeHours: Decimal.max(otOf(after).minus(beforeOt), 0), weeklyHoursAfter: perWeek[0]!.hours, weeks: perWeek };
}
