/**
 * Provincial employment-standards rules, as DATA (not branching code).
 *
 * - Effective-dated: laws change; payroll for a past period must use the rules
 *   that were in force then.
 * - Overridable per tenant (RuleOverride rows), e.g. a collective agreement
 *   that is more generous than the statute.
 * - Rules follow the FACILITY's province (where the work is done).
 *
 * IMPORTANT: every rule set ships with `verified: false`. The values reflect our
 * reading of each statute, but they MUST be reviewed by Canadian employment
 * counsel before production payroll is run on them. `sources` lists what to check.
 * Rules we are unsure of are left `null` (= not enforced) and surface a warning
 * rather than silently enforcing a guess.
 */
import type { Province } from '@prisma/client';
import type { DayDefinition } from './workDay.js';

/** A province, or the federal jurisdiction (Canada Labour Code) for federally regulated work. */
export type Jurisdiction = Province | 'FED';

export type OvertimeMethod =
  /** Daily OT first; weekly threshold counts only hours not already paid as daily OT (BC, SK, MB...). */
  | 'stacked'
  /** Compute daily-OT hours and weekly-OT hours separately and pay whichever is greater (AB). */
  | 'greater_of';

export type HolidayPayFormula =
  /** Eligible if employed 30 days and worked/earned on 15 of the 30 days before; avg day's pay. */
  | 'BC_30_DAY'
  /** Regular wages in the 4 work weeks before the holiday week ÷ 20. */
  | 'FOUR_WEEK_DIV_20'
  /** 5% of wages in the 4 weeks before the holiday. */
  | 'FOUR_WEEK_5PCT';

export interface YoungWorkerLimit {
  /** Applies to workers younger than this age. */
  underAge: number;
  schoolDayMaxHours?: number;
  schoolWeekMaxHours?: number;
  nonSchoolDayMaxHours?: number;
  nonSchoolWeekMaxHours?: number;
  /** May not work during school hours on a school day. */
  noWorkDuringSchoolHours?: boolean;
  /** Latest local clock time a shift may end, e.g. "21:00". */
  latestEnd?: string;
}

/**
 * The statutory meal break: `minutes` off (unpaid unless the person must stay available) so no one
 * works more than `afterHours` hours in a row; `everyHours` = one more break for each further
 * block of that many hours (AB, SK, federal). Scheduling warns when a shift long enough to need a
 * break has none planned; pay always deducts what the schedule plans, never more.
 */
export interface MealBreakRule {
  minutes: number;
  afterHours: number;
  everyHours?: number | null;
  source: string;
  /** Our reading needs counsel's confirmation (docs/COMPLIANCE.md). */
  counselVerify?: boolean;
}

/**
 * Minimum call-in / reporting pay: someone who reports for a scheduled shift and works less than
 * `minHours` is paid `minHours` at their regular rate (BC: `longShiftMinHours` when the shift was
 * scheduled for more than `longShiftOverHours`).
 */
export interface ReportingPayRule {
  minHours: number;
  longShiftOverHours?: number | null;
  longShiftMinHours?: number | null;
  source: string;
  counselVerify?: boolean;
}

export interface ProvinceRules {
  province: Jurisdiction;
  effectiveFrom: string; // ISO date
  verified: boolean;
  sources: string[];
  overtime: {
    dailyHours: number | null;
    dailyDoubleTimeHours: number | null;
    weeklyHours: number | null;
    method: OvertimeMethod;
    /** What a "day" is for daily overtime and daily hour limits (default: calendar day). See workDay.ts. */
    dayDefinition?: DayDefinition;
  };
  rest: {
    /** Minimum hours off between the end of one shift and the start of the next. */
    betweenShiftsHours: number | null;
    /** BC: a split shift (gap shorter than betweenShiftsHours) is allowed if it is completed within this many hours of starting. */
    splitShiftMaxSpanHours?: number | null;
    /** ON: the between-shift rest does not apply if total time worked on the successive shifts is at most this. */
    betweenShiftsExemptIfWorkedAtMost?: number | null;
    /**
     * Minimum consecutive hours off in each "day". Measured in every 24 hours that start at the
     * start of a shift (rest may cross midnight): our reading of ON ESA s. 18(1), pending counsel.
     */
    dailyConsecutiveHours: number | null;
    /** Minimum consecutive hours off in each work week (the longest off period inside the pay week). */
    weeklyConsecutiveHours: number | null;
    /** How the week for weekly rest is counted: the pay week (default) or any rolling 7 days. */
    weeklyRestPeriod?: 'pay_week' | 'rolling7';
    /** ON s. 18(4)(b): instead, this many consecutive hours in every period of two consecutive work weeks. */
    weeklyRestTwoWeekHours?: number | null;
  };
  vacation: {
    /** Highest tier whose minYears ≤ completed years of service applies. */
    tiers: Array<{ minYears: number; percent: number }>;
  };
  statutoryHoliday: {
    /** Multiplier for regular hours worked on a stat holiday. */
    workedMultiplier: number;
    holidayPayFormula: HolidayPayFormula | null;
  };
  youngWorkers: {
    minimumAge: number;
    parentalConsentUnder: number | null;
    limits: YoungWorkerLimit[];
  };
  /** Null/absent = no statutory meal-break rule encoded (not enforced; the organization's own settings apply). */
  mealBreak?: MealBreakRule | null;
  /** Null/absent = no statutory minimum encoded. */
  reportingPay?: ReportingPayRule | null;
}

const PENDING_REVIEW = 'Pending review by employment counsel';

const base = (
  province: Province,
  partial: Omit<ProvinceRules, 'province' | 'verified' | 'effectiveFrom'> & { effectiveFrom?: string },
): ProvinceRules => ({
  province,
  verified: false,
  effectiveFrom: partial.effectiveFrom ?? '2020-01-01',
  ...partial,
});

const RULES: ProvinceRules[] = [
  base('BC', {
    sources: ['Employment Standards Act (BC) ss. 35, 36, 40, 44, 58, Part 5; Employment Standards Regulation s. 45.1', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: 12, weeklyHours: 40, method: 'stacked', dayDefinition: 'shift_start_past_midnight' },
    rest: { betweenShiftsHours: 8, splitShiftMaxSpanHours: 12, dailyConsecutiveHours: null, weeklyConsecutiveHours: 32 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 5, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: 'BC_30_DAY' },
    youngWorkers: {
      minimumAge: 14,
      parentalConsentUnder: 16,
      limits: [
        {
          underAge: 16,
          schoolDayMaxHours: 4,
          schoolWeekMaxHours: 20,
          nonSchoolDayMaxHours: 7,
          nonSchoolWeekMaxHours: 35,
          noWorkDuringSchoolHours: true,
        },
      ],
    },
  }),
  base('ON', {
    sources: ['Employment Standards Act, 2000 (ON) ss. 18, 22, 24, 35.2; O. Reg. 285/01', PENDING_REVIEW],
    overtime: { dailyHours: null, dailyDoubleTimeHours: null, weeklyHours: 44, method: 'stacked' },
    rest: { betweenShiftsHours: 8, betweenShiftsExemptIfWorkedAtMost: 13, dailyConsecutiveHours: 11, weeklyConsecutiveHours: 24, weeklyRestTwoWeekHours: 48 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 5, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: 'FOUR_WEEK_DIV_20' },
    youngWorkers: {
      minimumAge: 14,
      parentalConsentUnder: null,
      limits: [{ underAge: 16, noWorkDuringSchoolHours: true }],
    },
  }),
  base('AB', {
    sources: ['Employment Standards Code (AB) ss. 18, 21, 22, 34, 41; Employment Standards Regulation Part 3', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 44, method: 'greater_of', dayDefinition: 'shift_start_past_midnight' },
    rest: { betweenShiftsHours: 8, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 5, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 13, parentalConsentUnder: 16, limits: [{ underAge: 16, noWorkDuringSchoolHours: true, latestEnd: '21:00' }] },
  }),
  base('QC', {
    sources: ['Act respecting labour standards (QC) ss. 52, 62, 68, 74, 78, 84.2–84.7; Act respecting the regulation of child labour (2023)', PENDING_REVIEW],
    overtime: { dailyHours: null, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 32 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 3, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.0, holidayPayFormula: 'FOUR_WEEK_DIV_20' },
    youngWorkers: {
      minimumAge: 14,
      parentalConsentUnder: 14,
      limits: [{ underAge: 16, schoolWeekMaxHours: 17, noWorkDuringSchoolHours: true }],
    },
  }),
  base('SK', {
    sources: ['The Saskatchewan Employment Act Part II', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: 8, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 5.77 }, { minYears: 10, percent: 7.69 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: 'FOUR_WEEK_5PCT' },
    youngWorkers: { minimumAge: 14, parentalConsentUnder: 16, limits: [{ underAge: 16, schoolWeekMaxHours: 16, noWorkDuringSchoolHours: true }] },
  }),
  base('MB', {
    sources: ['The Employment Standards Code (MB)', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 5, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 13, parentalConsentUnder: 16, limits: [{ underAge: 16, schoolWeekMaxHours: 20 }] },
  }),
  base('NB', {
    sources: ['Employment Standards Act (NB); Minimum Wage Regulation', PENDING_REVIEW],
    overtime: { dailyHours: null, dailyDoubleTimeHours: null, weeklyHours: 44, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 8, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 14, parentalConsentUnder: 16, limits: [{ underAge: 16, schoolDayMaxHours: 3, noWorkDuringSchoolHours: true }] },
  }),
  base('NS', {
    sources: ['Labour Standards Code (NS)', PENDING_REVIEW],
    overtime: { dailyHours: null, dailyDoubleTimeHours: null, weeklyHours: 48, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 8, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 14, parentalConsentUnder: null, limits: [{ underAge: 16, schoolDayMaxHours: 3, noWorkDuringSchoolHours: true }] },
  }),
  base('PE', {
    sources: ['Employment Standards Act (PE)', PENDING_REVIEW],
    overtime: { dailyHours: null, dailyDoubleTimeHours: null, weeklyHours: 48, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 8, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 14, parentalConsentUnder: 16, limits: [{ underAge: 16, noWorkDuringSchoolHours: true }] },
  }),
  base('NL', {
    sources: ['Labour Standards Act (NL)', PENDING_REVIEW],
    overtime: { dailyHours: null, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: 8, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 15, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 2.0, holidayPayFormula: null },
    youngWorkers: { minimumAge: 14, parentalConsentUnder: 16, limits: [{ underAge: 16, schoolDayMaxHours: 3, noWorkDuringSchoolHours: true }] },
  }),
  base('YT', {
    sources: ['Employment Standards Act (YT)', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 6, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 14, parentalConsentUnder: 17, limits: [] },
  }),
  base('NT', {
    sources: ['Employment Standards Act (NT)', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 6, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 16, parentalConsentUnder: null, limits: [] },
  }),
  base('NU', {
    sources: ['Labour Standards Act (NU)', PENDING_REVIEW],
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
    rest: { betweenShiftsHours: null, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
    vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 5, percent: 6 }] },
    statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: null },
    youngWorkers: { minimumAge: 16, parentalConsentUnder: null, limits: [] },
  }),
];

/**
 * Meal breaks and minimum call-in pay by jurisdiction. Our reading of each statute, PENDING
 * COUNSEL REVIEW (docs/COMPLIANCE.md lists every source and the items to confirm).
 */
const MEAL_BREAKS: Partial<Record<Jurisdiction, MealBreakRule>> = {
  BC: { minutes: 30, afterHours: 5, source: 'ESA (BC) s. 32' },
  AB: { minutes: 30, afterHours: 5, everyHours: 5, source: 'Employment Standards Code (AB) s. 18', counselVerify: true },
  SK: { minutes: 30, afterHours: 5, everyHours: 5, source: 'Saskatchewan Employment Act s. 2-23', counselVerify: true },
  MB: { minutes: 30, afterHours: 5, source: 'Employment Standards Code (MB) s. 50' },
  ON: { minutes: 30, afterHours: 5, source: 'ESA, 2000 (ON) s. 20' },
  QC: { minutes: 30, afterHours: 5, source: 'Act respecting labour standards (QC) s. 79' },
  NB: { minutes: 30, afterHours: 5, source: 'Employment Standards Act (NB) s. 17.1', counselVerify: true },
  NS: { minutes: 30, afterHours: 5, source: 'Labour Standards Code (NS) s. 66A', counselVerify: true },
  PE: { minutes: 30, afterHours: 5, source: 'Employment Standards Act (PE) s. 16', counselVerify: true },
  NL: { minutes: 60, afterHours: 5, source: 'Labour Standards Act (NL) s. 23', counselVerify: true },
  YT: { minutes: 30, afterHours: 5, source: 'Employment Standards Act (YT) s. 11', counselVerify: true },
  FED: { minutes: 30, afterHours: 5, everyHours: 5, source: 'Canada Labour Code s. 169.1' },
};
const REPORTING_PAY: Partial<Record<Jurisdiction, ReportingPayRule>> = {
  BC: { minHours: 2, longShiftOverHours: 8, longShiftMinHours: 4, source: 'ESA (BC) s. 34' },
  AB: { minHours: 3, source: 'Employment Standards Code (AB) s. 21', counselVerify: true },
  SK: { minHours: 3, source: 'Saskatchewan Employment Act Part II / Employment Standards Regulations (SK)', counselVerify: true },
  MB: { minHours: 3, source: 'Employment Standards Code (MB) s. 51', counselVerify: true },
  ON: { minHours: 3, source: 'O. Reg. 285/01 s. 21.2 ("three-hour rule": applies to someone who regularly works more than 3 hours a day)', counselVerify: true },
  QC: { minHours: 3, source: 'Act respecting labour standards (QC) s. 58' },
  NB: { minHours: 3, source: 'Minimum Wage Regulation (NB)', counselVerify: true },
  NS: { minHours: 3, source: 'Minimum Wage Order (General) (NS)', counselVerify: true },
  PE: { minHours: 3, source: 'Employment Standards Act (PE)', counselVerify: true },
  NL: { minHours: 3, source: 'Labour Standards Regulations (NL)', counselVerify: true },
  FED: { minHours: 3, source: 'Canada Labour Standards Regulations s. 11.1' },
};

/**
 * Federally regulated work (Canada Labour Code Part III; Canada Labour Standards Regulations).
 * Used for scheduling when the organization (or a department) is marked federally regulated.
 * Payroll still follows the facility's province (see docs/COMPLIANCE.md).
 */
const FEDERAL: ProvinceRules = {
  province: 'FED',
  verified: false,
  effectiveFrom: '2019-09-01',
  sources: ['Canada Labour Code Part III ss. 169, 173, 173.01, 173.1, 174, 179; Canada Labour Standards Regulations', PENDING_REVIEW],
  overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 40, method: 'stacked' },
  rest: { betweenShiftsHours: 8, dailyConsecutiveHours: null, weeklyConsecutiveHours: 24 },
  vacation: { tiers: [{ minYears: 0, percent: 4 }, { minYears: 5, percent: 6 }, { minYears: 10, percent: 8 }] },
  statutoryHoliday: { workedMultiplier: 1.5, holidayPayFormula: 'FOUR_WEEK_5PCT' },
  // Under 17 may work only in limited cases and never 11 p.m.–6 a.m.; we require 17 (counsel to confirm).
  youngWorkers: { minimumAge: 17, parentalConsentUnder: null, limits: [] },
};

/** Hours of notice the Canada Labour Code (s. 173.1) asks for a work schedule. */
export const FEDERAL_SCHEDULE_NOTICE_HOURS = 96;

export interface RuleOverrideInput {
  province: Province | null;
  ruleKey: string; // dotted path, e.g. "overtime.dailyHours"
  value: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export const ALLOWED_OVERRIDE_KEYS = new Set([
  'overtime.dailyHours',
  'overtime.dailyDoubleTimeHours',
  'overtime.weeklyHours',
  'overtime.method',
  'rest.betweenShiftsHours',
  'rest.dailyConsecutiveHours',
  'rest.weeklyConsecutiveHours',
  'vacation.tiers',
  'statutoryHoliday.workedMultiplier',
]);

/**
 * Resolve the rules in force for a province on a date, with tenant overrides applied.
 * Overrides may only make rules MORE protective of workers; the caller (admin UI)
 * is responsible for showing the statutory value next to the override.
 */
export function resolveRules(
  province: Province,
  onDate: string,
  overrides: RuleOverrideInput[] = [],
  opts: { federal?: boolean } = {},
): ProvinceRules {
  if (opts.federal) {
    const rules: ProvinceRules = structuredClone(FEDERAL);
    rules.mealBreak ??= MEAL_BREAKS.FED ?? null;
    rules.reportingPay ??= REPORTING_PAY.FED ?? null;
    for (const o of overrides.filter((x) => x.province === null && x.effectiveFrom <= onDate && (x.effectiveTo === null || x.effectiveTo >= onDate)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
      if (!ALLOWED_OVERRIDE_KEYS.has(o.ruleKey)) throw new Error(`Rule override key not allowed: ${o.ruleKey}`);
      const [group, key] = o.ruleKey.split('.') as [keyof ProvinceRules, string];
      (rules[group] as unknown as Record<string, unknown>)[key] = o.value;
    }
    return rules;
  }
  const candidates = RULES.filter((r) => r.province === province && r.effectiveFrom <= onDate).sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const found = candidates[0];
  if (!found) throw new Error(`No employment-standards rules for ${province} on ${onDate}`);
  const rules: ProvinceRules = structuredClone(found);
  rules.mealBreak ??= MEAL_BREAKS[province] ?? null;
  rules.reportingPay ??= REPORTING_PAY[province] ?? null;

  const applicable = overrides
    .filter(
      (o) =>
        (o.province === null || o.province === province) &&
        o.effectiveFrom <= onDate &&
        (o.effectiveTo === null || o.effectiveTo >= onDate),
    )
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  for (const o of applicable) {
    if (!ALLOWED_OVERRIDE_KEYS.has(o.ruleKey)) {
      throw new Error(`Rule override key not allowed: ${o.ruleKey}`);
    }
    const [group, key] = o.ruleKey.split('.') as [keyof ProvinceRules, string];
    (rules[group] as unknown as Record<string, unknown>)[key] = o.value;
  }
  return rules;
}

export function vacationPercent(rules: ProvinceRules, completedYears: number): number {
  let pct = 0;
  for (const t of rules.vacation.tiers) if (completedYears >= t.minYears) pct = t.percent;
  return pct;
}

/** The statutory meal break and minimum call-in pay for a jurisdiction (null = none encoded). */
export function mealBreakRule(j: Jurisdiction): MealBreakRule | null {
  return MEAL_BREAKS[j] ?? null;
}
export function reportingPayRule(j: Jurisdiction): ReportingPayRule | null {
  return REPORTING_PAY[j] ?? null;
}

/** The federal rule set (for the compliance screen). */
export function federalRules(): ProvinceRules {
  return { ...FEDERAL, mealBreak: MEAL_BREAKS.FED ?? null, reportingPay: REPORTING_PAY.FED ?? null };
}

/**
 * The most consecutive working days the weekly-rest rule leaves possible: with a full day off
 * required in each pay week, at most 12 calendar days in a row (off on the first day of one week
 * and the last day of the next). The organization's "max days in a row" is capped by this.
 */
export function maxConsecutiveDaysAllowed(rules: Pick<ProvinceRules, 'rest'>): number {
  return rules.rest.weeklyConsecutiveHours ? 12 : 13;
}
