/**
 * Settings for "Fill the schedule" (the whole-horizon solver), kept in the organization's
 * existing `overtimePolicy` JSON under the `solver` key (no schema change):
 *
 *   solver: {
 *     planAheadWeeks: 1 | 2 | 4 | 13,   // ONE "Plan ahead" setting: the availability planning
 *                                        // window AND the default fill horizon
 *     weights: { fairness, overtime, continuity, targetHours, spread, preferences, seniority },  // 0–10
 *     toggles: { keepAssigned, avoidOvertime, spreadWeekends, sameFacility },
 *     limits:  { maxConsecutiveDays, maxDailyHours },   // enforced on EVERY path (evaluateCandidate)
 *     fullTimeTargetHours,               // weekly hours full-time staff aim for (org-wide; a department's wins)
 *     minShiftHours,                     // shortest shift the forecast proposes (default 3)
 *     travelMinutes,                     // time needed between two facilities (default 30)
 *     federallyRegulated,                // schedule under the Canada Labour Code rule set
 *     holidayClosedFacilityIds,          // facilities closed on statutory holidays (forecast proposes nothing)
 *     templateAutoCreate,                // the worker keeps weekly shift templates' next weeks drafted (default off)
 *     bidSeniorityBasis,                 // shift bidding: 'DATE' (seniority date, then hours) or 'HOURS' (default DATE)
 *     lastHorizonWeeks,                  // the last horizon someone ran (shown as a hint)
 *     departments: { [departmentId]: { planAheadWeeks?, weights?, toggles?, useSeniority?, targetHours?, limits?, federallyRegulated? } }
 *   }
 *
 * A department's own values win; anything it leaves out falls back to the organization's.
 * `useSeniority` per department can only narrow the organization's seniority switch: a
 * department can turn seniority off (its agreement doesn't use it), never on when the
 * organization has it off.
 */
import { z } from 'zod';

export const HORIZONS = [1, 2, 4, 13] as const;
export type HorizonWeeks = (typeof HORIZONS)[number];

export interface SolverWeights {
  /** Spread hours evenly (against the hours each person already has this horizon). */
  fairness: number;
  /** Avoid overtime cost, and give unavoidable overtime to whoever has had least (the ledger). */
  overtime: number;
  /** Keep people at the same facility and on the shifts they already had. */
  continuity: number;
  /** Bring full- and part-time staff up to their contracted hours first. */
  targetHours: number;
  /** Rotate weekends and evenings fairly. */
  spread: number;
  /** Prefer each person's main position and people who confirmed their availability. */
  preferences: number;
  /** Give hours by seniority (only where the organization and department use seniority). */
  seniority: number;
}

export interface SolverToggles { keepAssigned: boolean; avoidOvertime: boolean; spreadWeekends: boolean; sameFacility: boolean }
export interface SolverLimits { maxConsecutiveDays: number; maxDailyHours: number }

export interface DepartmentSolverSettings {
  planAheadWeeks?: HorizonWeeks;
  weights?: Partial<SolverWeights>;
  toggles?: Partial<SolverToggles>;
  /** null/undefined = the organization's switch. */
  useSeniority?: boolean | null;
  /** Weekly hours full-time staff in this department aim for when they have no contracted minimum. */
  targetHours?: number | null;
  /** The department's own limits (stricter or looser than the organization's). */
  limits?: Partial<SolverLimits>;
  /** null/undefined = the organization's. */
  federallyRegulated?: boolean | null;
}

export interface SolverSettings {
  planAheadWeeks: HorizonWeeks;
  weights: SolverWeights;
  toggles: SolverToggles;
  limits: SolverLimits;
  lastHorizonWeeks: HorizonWeeks | null;
  fullTimeTargetHours: number | null;
  minShiftHours: number;
  travelMinutes: number;
  federallyRegulated: boolean;
  holidayClosedFacilityIds: string[];
  /** Weekly shift templates: the worker drafts each template's next weeks (its autoWeeksAhead). Off by default. */
  templateAutoCreate: boolean;
  /** Shift bidding's default seniority basis (a round can set its own): date then hours, or hours then date. */
  bidSeniorityBasis: 'DATE' | 'HOURS';
  departments: Record<string, DepartmentSolverSettings>;
}

export const DEFAULT_WEIGHTS: SolverWeights = { fairness: 6, overtime: 7, continuity: 4, targetHours: 6, spread: 5, preferences: 3, seniority: 5 };
export const DEFAULT_TOGGLES: SolverToggles = { keepAssigned: true, avoidOvertime: true, spreadWeekends: true, sameFacility: true };
export const DEFAULT_LIMITS: SolverLimits = { maxConsecutiveDays: 6, maxDailyHours: 12 };
export const DEFAULT_PLAN_AHEAD: HorizonWeeks = 2;
export const DEFAULT_MIN_SHIFT_HOURS = 3;
export const DEFAULT_TRAVEL_MINUTES = 30;

const weight = z.number().min(0).max(10);
export const weightsBody = z.object({ fairness: weight, overtime: weight, continuity: weight, targetHours: weight, spread: weight, preferences: weight, seniority: weight }).partial();
export const togglesBody = z.object({ keepAssigned: z.boolean(), avoidOvertime: z.boolean(), spreadWeekends: z.boolean(), sameFacility: z.boolean() }).partial();
export const horizonBody = z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(13)]);
// 12 days in a row is the most weekly rest (a day off in each pay week) leaves possible.
export const limitsBody = z.object({ maxConsecutiveDays: z.number().int().min(1).max(12), maxDailyHours: z.number().min(4).max(24) }).partial();
export const orgExtrasBody = z.object({
  fullTimeTargetHours: z.number().min(0).max(60).nullable(),
  minShiftHours: z.number().min(1).max(12),
  travelMinutes: z.number().int().min(0).max(240),
  federallyRegulated: z.boolean(),
  holidayClosedFacilityIds: z.array(z.string().uuid()).max(500),
  templateAutoCreate: z.boolean(),
  bidSeniorityBasis: z.enum(['DATE', 'HOURS']),
}).partial();
export const departmentBody = z.object({
  planAheadWeeks: horizonBody.optional(),
  weights: weightsBody.optional(),
  toggles: togglesBody.optional(),
  useSeniority: z.boolean().nullable().optional(),
  targetHours: z.number().min(0).max(60).nullable().optional(),
  limits: limitsBody.optional(),
  federallyRegulated: z.boolean().nullable().optional(),
});

const isHorizon = (n: unknown): n is HorizonWeeks => HORIZONS.includes(n as HorizonWeeks);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readWeights(v: unknown): Partial<SolverWeights> {
  const r = weightsBody.safeParse(obj(v));
  return r.success ? r.data : {};
}
function readToggles(v: unknown): Partial<SolverToggles> {
  const r = togglesBody.safeParse(obj(v));
  return r.success ? r.data : {};
}

/** Reads `overtimePolicy.solver`; anything missing or invalid takes the default. */
export function parseSolverSettings(overtimePolicy: unknown): SolverSettings {
  const s = obj(obj(overtimePolicy).solver);
  const departments: Record<string, DepartmentSolverSettings> = {};
  for (const [id, raw] of Object.entries(obj(s.departments))) {
    const d = obj(raw);
    departments[id] = {
      ...(isHorizon(d.planAheadWeeks) ? { planAheadWeeks: d.planAheadWeeks } : {}),
      weights: readWeights(d.weights),
      toggles: readToggles(d.toggles),
      useSeniority: typeof d.useSeniority === 'boolean' ? d.useSeniority : null,
      targetHours: typeof d.targetHours === 'number' && d.targetHours >= 0 && d.targetHours <= 60 ? d.targetHours : null,
      limits: (() => {
        const r = limitsBody.safeParse(obj(d.limits));
        return r.success ? r.data : {};
      })(),
      federallyRegulated: typeof d.federallyRegulated === 'boolean' ? d.federallyRegulated : null,
    };
  }
  const extras = orgExtrasBody.safeParse({
    ...(s.fullTimeTargetHours !== undefined ? { fullTimeTargetHours: s.fullTimeTargetHours } : {}),
    ...(s.minShiftHours !== undefined ? { minShiftHours: s.minShiftHours } : {}),
    ...(s.travelMinutes !== undefined ? { travelMinutes: s.travelMinutes } : {}),
    ...(s.federallyRegulated !== undefined ? { federallyRegulated: s.federallyRegulated } : {}),
    ...(s.holidayClosedFacilityIds !== undefined ? { holidayClosedFacilityIds: s.holidayClosedFacilityIds } : {}),
    ...(s.templateAutoCreate !== undefined ? { templateAutoCreate: s.templateAutoCreate } : {}),
    ...(s.bidSeniorityBasis !== undefined ? { bidSeniorityBasis: s.bidSeniorityBasis } : {}),
  });
  const x = extras.success ? extras.data : {};
  // An older stored 13 (before the weekly-rest cap) reads as 12.
  const rawLimits = { ...obj(s.limits) };
  if (typeof rawLimits.maxConsecutiveDays === 'number' && rawLimits.maxConsecutiveDays > 12) rawLimits.maxConsecutiveDays = 12;
  const limits = limitsBody.safeParse(rawLimits);
  return {
    planAheadWeeks: isHorizon(s.planAheadWeeks) ? s.planAheadWeeks : DEFAULT_PLAN_AHEAD,
    weights: { ...DEFAULT_WEIGHTS, ...readWeights(s.weights) },
    toggles: { ...DEFAULT_TOGGLES, ...readToggles(s.toggles) },
    limits: { ...DEFAULT_LIMITS, ...(limits.success ? limits.data : {}) },
    lastHorizonWeeks: isHorizon(s.lastHorizonWeeks) ? s.lastHorizonWeeks : null,
    fullTimeTargetHours: x.fullTimeTargetHours ?? null,
    minShiftHours: x.minShiftHours ?? DEFAULT_MIN_SHIFT_HOURS,
    travelMinutes: x.travelMinutes ?? DEFAULT_TRAVEL_MINUTES,
    federallyRegulated: x.federallyRegulated ?? false,
    holidayClosedFacilityIds: x.holidayClosedFacilityIds ?? [],
    templateAutoCreate: x.templateAutoCreate ?? false,
    bidSeniorityBasis: x.bidSeniorityBasis ?? 'DATE',
    departments,
  };
}

export interface EffectiveSettings {
  planAheadWeeks: HorizonWeeks;
  weights: SolverWeights;
  toggles: SolverToggles;
  limits: SolverLimits;
  useSeniority: boolean;
  /** Weekly hours a full-time person aims for: the department's, else the organization's. */
  targetHours: number | null;
  federallyRegulated: boolean;
  travelMinutes: number;
  minShiftHours: number;
  /** Where the plan-ahead window comes from. */
  planAheadFrom: 'department' | 'organization';
}

/**
 * The settings a run in one department uses. `orgSeniority` is the organization's feature switch:
 * when it is off, seniority is off everywhere, whatever a department says.
 */
export function effectiveSettings(s: SolverSettings, departmentId: string | null, orgSeniority: boolean): EffectiveSettings {
  const d = (departmentId && s.departments[departmentId]) || {};
  const useSeniority = orgSeniority && d.useSeniority !== false;
  const weights = { ...s.weights, ...(d.weights ?? {}) };
  return {
    planAheadWeeks: d.planAheadWeeks ?? s.planAheadWeeks,
    planAheadFrom: d.planAheadWeeks ? 'department' : 'organization',
    weights: { ...weights, seniority: useSeniority ? weights.seniority : 0 },
    toggles: { ...s.toggles, ...(d.toggles ?? {}) },
    limits: { ...s.limits, ...(d.limits ?? {}) },
    useSeniority,
    targetHours: d.targetHours ?? s.fullTimeTargetHours ?? null,
    federallyRegulated: d.federallyRegulated ?? s.federallyRegulated,
    travelMinutes: s.travelMinutes,
    minShiftHours: s.minShiftHours,
  };
}

/** Writes the solver settings back without touching the overtime policy's own keys. */
export function withSolverSettings(overtimePolicy: unknown, solver: SolverSettings): Record<string, unknown> {
  return { ...obj(overtimePolicy), solver };
}
