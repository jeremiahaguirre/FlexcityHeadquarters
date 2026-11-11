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
import type { ProvinceRules } from '../compliance/provincialRules.js';
import { calculatePay } from '../payroll/payCalc.js';

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
  | 'HOS_WEEKLY';

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
  existingShifts: Array<Interval & { positionId: string; facilityId?: string; id?: string }>;
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
}

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
  if (rules.rest.dailyConsecutiveHours !== null) {
    const required = rules.rest.dailyConsecutiveHours;
    const all = [...c.existingShifts, shift];
    for (let d = shiftStartDate; d <= shiftEndDate; d = addDays(d, 1)) {
      const longest = longestFreeGapInDay(all, d, tz);
      if (longest < required) {
        blocks.push({
          code: 'DAILY_REST',
          message: `Would leave only ${longest.toFixed(1)}h consecutive rest on ${d} (${required}h required).`,
        });
        break;
      }
    }
  }

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
  const { overtimeHours, weeklyHoursAfter } = projectOvertime(c.existingShifts, shift, opts);
  if (c.weeklyMaxHours !== null && weeklyHoursAfter.gt(c.weeklyMaxHours)) {
    blocks.push({
      code: 'OVER_PERSONAL_WEEKLY_MAX',
      message: `Would reach ${weeklyHoursAfter.toFixed(2)}h this week (cap ${c.weeklyMaxHours.toFixed(2)}h).`,
    });
  }
  for (const message of accommodationBlocks(c.restrictions ?? [], { start: shift.start, end: shift.end, positionId: shift.positionId, timezone: tz }, weeklyHoursAfter)) {
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

/** Longest stretch with no work inside one local calendar day, in hours. */
function longestFreeGapInDay(shifts: Interval[], isoDate: string, tz: string): number {
  const dayStart = startOfLocalDay(isoDate, tz);
  const dayEnd = startOfLocalDay(addDays(isoDate, 1), tz);
  const busy = mergeIntervals(
    shifts
      .filter((s) => overlaps(s, { start: dayStart, end: dayEnd }))
      .map((s) => ({ start: s.start < dayStart ? dayStart : s.start, end: s.end > dayEnd ? dayEnd : s.end })),
  );
  let longest = 0;
  let cursor = dayStart;
  for (const b of busy) {
    longest = Math.max(longest, hoursBetween(cursor, b.start));
    cursor = b.end;
  }
  return Math.max(longest, hoursBetween(cursor, dayEnd));
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
      const s = startOfLocalDay(day, tz).getTime();
      const school = {
        start: new Date(s + cal.schoolHours.startMinute * 60_000),
        end: new Date(s + cal.schoolHours.endMinute * 60_000),
      };
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

/** Within the person's submitted availability (a hard rule for generated schedules, a warning for manual ones). */
export function isAvailable(windows: CandidateContext['availability'], shift: Pick<ShiftSpec, 'start' | 'end' | 'timezone'>): boolean {
  const day = localDate(shift.start, shift.timezone);
  const dow = dayOfWeek(day);
  const dayStartMs = startOfLocalDay(day, shift.timezone).getTime();
  const startMin = (shift.start.getTime() - dayStartMs) / 60_000;
  const endMin = (shift.end.getTime() - dayStartMs) / 60_000;
  return windows.some(
    (w) =>
      w.dayOfWeek === dow &&
      w.effectiveFrom <= day &&
      (w.effectiveTo === null || w.effectiveTo >= day) &&
      w.startMinute <= startMin &&
      w.endMinute >= endMin,
  );
}

/**
 * Overtime this shift would ADD, computed with the same engine as payroll so the
 * Shift Board warning and the pay stub can never disagree.
 */
export function projectOvertime(
  existing: Array<Interval & { positionId: string }>,
  shift: ShiftSpec,
  opts: Pick<EvaluateOptions, 'rules' | 'payWeekStartDay'>,
): { overtimeHours: Decimal; weeklyHoursAfter: Decimal } {
  const tz = shift.timezone;
  const periodStart = payWeekStart(localDate(shift.start, tz), opts.payWeekStartDay);
  const lastWeek = payWeekStart(localDate(new Date(shift.end.getTime() - 1), tz), opts.payWeekStartDay);
  const weeks = lastWeek === periodStart ? 1 : 2;
  const run = (intervals: Array<Interval & { positionId: string }>) =>
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
  const before = run(nonOverlapping);
  const after = run([...nonOverlapping, shift]);

  const weekFrom = startOfLocalDay(periodStart, tz);
  const weekTo = startOfLocalDay(addDays(periodStart, 7), tz);
  const weeklyHoursAfter = new Decimal(sumHoursWithin([...nonOverlapping, shift], weekFrom, weekTo));
  return { overtimeHours: Decimal.max(otOf(after).minus(otOf(before)), 0), weeklyHoursAfter };
}
