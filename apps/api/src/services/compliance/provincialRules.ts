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

export interface ProvinceRules {
  province: Province;
  effectiveFrom: string; // ISO date
  verified: boolean;
  sources: string[];
  overtime: {
    dailyHours: number | null;
    dailyDoubleTimeHours: number | null;
    weeklyHours: number | null;
    method: OvertimeMethod;
  };
  rest: {
    /** Minimum hours off between the end of one shift and the start of the next. */
    betweenShiftsHours: number | null;
    /** BC: a split shift (gap shorter than betweenShiftsHours) is allowed if it is completed within this many hours of starting. */
    splitShiftMaxSpanHours?: number | null;
    /** ON: the between-shift rest does not apply if total time worked on the successive shifts is at most this. */
    betweenShiftsExemptIfWorkedAtMost?: number | null;
    /** Minimum consecutive hours off within each local calendar day. */
    dailyConsecutiveHours: number | null;
    /** Minimum consecutive hours off in each work week. */
    weeklyConsecutiveHours: number | null;
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
    overtime: { dailyHours: 8, dailyDoubleTimeHours: 12, weeklyHours: 40, method: 'stacked' },
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
    rest: { betweenShiftsHours: 8, betweenShiftsExemptIfWorkedAtMost: 13, dailyConsecutiveHours: 11, weeklyConsecutiveHours: 24 },
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
    overtime: { dailyHours: 8, dailyDoubleTimeHours: null, weeklyHours: 44, method: 'greater_of' },
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
): ProvinceRules {
  const candidates = RULES.filter((r) => r.province === province && r.effectiveFrom <= onDate).sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const found = candidates[0];
  if (!found) throw new Error(`No employment-standards rules for ${province} on ${onDate}`);
  const rules: ProvinceRules = structuredClone(found);

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

export function allRuleSets(): readonly ProvinceRules[] {
  return RULES;
}
