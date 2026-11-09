/**
 * Scheduling ASSISTANT (MVP). Proposes a draft; a supervisor reviews and publishes.
 *
 * Deliberate differences from the original "Auto-Scheduler" waterfall:
 *  - Every hard rule is enforced by the same evaluateCandidate() used by the
 *    Shift Board, so a draft can never contain an assignment the board would refuse.
 *  - It never schedules overtime automatically — those shifts are left unfilled
 *    with a reason, for a human to decide.
 *  - Shadow tiers are an explicit manager setting. The reliability score is
 *    NOT an input (Quebec Law 25 s.12.1: no decisions based exclusively on
 *    automated processing of personal information without notice and review).
 *  - Unfilled shifts carry a human-readable conflictReason ("3 qualified staff:
 *    2 on time off, 1 would exceed rest period").
 *
 * The greedy pass here is adequate for a single facility/week. For large multi-
 * facility terms, swap in a constraint solver (OR-Tools CP-SAT) behind the same
 * input/output types — see docs/ROADMAP.md.
 */
import type { Decimal } from '../../lib/money.js';
import type { ProvinceRules } from '../compliance/provincialRules.js';
import {
  type BlockCode,
  type CandidateContext,
  type PositionSpec,
  type SchoolCalendar,
  type ShiftSpec,
  evaluateCandidate,
} from './eligibility.js';

export type DistributionMode = 'SENIORITY' | 'EGALITARIAN';
export type EmploymentStatus = 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'ON_CALL' | 'VOLUNTEER';
export type ShadowTier = 'A_SQUAD' | 'B_SQUAD' | 'C_SQUAD' | 'UNASSIGNED';

export interface AssistantCandidate extends CandidateContext {
  employmentStatus: EmploymentStatus;
  shadowTier: ShadowTier;
  seniorityDate: string | null;
  seniorityHours: Decimal;
  weeklyMinHours: Decimal | null;
}

export interface AssistantInput {
  shifts: Array<{ shift: ShiftSpec; position: PositionSpec }>;
  candidates: AssistantCandidate[];
  rules: ProvinceRules;
  payWeekStartDay: number;
  distributionMode: DistributionMode;
  useShadowTiers: boolean;
  schoolCalendar?: SchoolCalendar;
}

export interface AssistantOutput {
  assignments: Array<{ shiftId: string; userId: string }>;
  unfilled: Array<{ shiftId: string; reason: string }>;
}

const TIER_ORDER: Record<ShadowTier, number> = { A_SQUAD: 0, B_SQUAD: 1, C_SQUAD: 2, UNASSIGNED: 3 };

const BLOCK_LABEL: Partial<Record<BlockCode, string>> = {
  OVERLAPPING_SHIFT: 'already scheduled',
  ON_APPROVED_TIME_OFF: 'on time off',
  REST_BETWEEN_SHIFTS: 'would break rest period',
  DAILY_REST: 'would break daily rest',
  NOT_AVAILABLE: 'not available',
  CERTIFICATION_EXPIRES: 'certification expiring',
  MISSING_CERTIFICATION: 'missing certification',
  PREREQUISITE_LAPSED: 'prerequisite lapsed',
  OVER_PERSONAL_WEEKLY_MAX: 'at weekly hour cap',
  YOUNG_WORKER_LIMIT: 'young-worker limit',
  UNDER_MINIMUM_AGE: 'under minimum age',
  NOT_QUALIFIED_FOR_POSITION: 'not qualified',
};

export function proposeSchedule(input: AssistantInput): AssistantOutput {
  // Work on copies: assignments made during this run feed later evaluations.
  const pool = input.candidates.map((c) => ({ ...c, existingShifts: [...c.existingShifts] }));
  const assignments: AssistantOutput['assignments'] = [];
  const unfilled: AssistantOutput['unfilled'] = [];

  const ordered = [...input.shifts].sort((a, b) => a.shift.start.getTime() - b.shift.start.getTime());

  for (const { shift, position } of ordered) {
    const evaluated = pool
      .filter((c) => c.employmentStatus !== 'VOLUNTEER')
      .map((c) => ({
        c,
        e: evaluateCandidate(c, shift, position, {
          rules: input.rules,
          payWeekStartDay: input.payWeekStartDay,
          requireAvailability: true,
          schoolCalendar: input.schoolCalendar,
        }),
      }));

    const viable = evaluated.filter(({ e }) => e.eligible && e.overtimeHours.eq(0));
    if (viable.length === 0) {
      unfilled.push({ shiftId: shift.id, reason: explain(evaluated.map(({ e }) => e)) });
      continue;
    }

    viable.sort((x, y) => compare(x, y, input));
    const winner = viable[0]!.c;
    winner.existingShifts.push({ start: shift.start, end: shift.end, positionId: shift.positionId });
    assignments.push({ shiftId: shift.id, userId: winner.userId });
  }

  return { assignments, unfilled };
}

type Scored = { c: AssistantCandidate; e: ReturnType<typeof evaluateCandidate> };

function employmentTier(s: Scored): number {
  const { c, e } = s;
  const hoursBefore = e.weeklyHoursAfter; // includes this shift
  switch (c.employmentStatus) {
    case 'FULL_TIME':
      // Tier 1 only while below their weekly minimum.
      return c.weeklyMinHours && hoursBefore.lte(c.weeklyMinHours) ? 0 : 1;
    case 'PART_TIME':
      return 1;
    case 'CASUAL':
      return 2;
    case 'ON_CALL':
      return 3;
    case 'VOLUNTEER':
      return 9;
  }
}

function compare(x: Scored, y: Scored, input: AssistantInput): number {
  const t = employmentTier(x) - employmentTier(y);
  if (t !== 0) return t;
  if (input.useShadowTiers) {
    const s = TIER_ORDER[x.c.shadowTier] - TIER_ORDER[y.c.shadowTier];
    if (s !== 0) return s;
  }
  if (input.distributionMode === 'EGALITARIAN') {
    const h = x.e.weeklyHoursAfter.comparedTo(y.e.weeklyHoursAfter);
    if (h !== 0) return h;
  } else {
    const xd = x.c.seniorityDate ?? '9999-12-31';
    const yd = y.c.seniorityDate ?? '9999-12-31';
    if (xd !== yd) return xd < yd ? -1 : 1;
    const sh = y.c.seniorityHours.comparedTo(x.c.seniorityHours);
    if (sh !== 0) return sh;
  }
  return x.c.userId.localeCompare(y.c.userId); // deterministic
}

function explain(evals: Array<ReturnType<typeof evaluateCandidate>>): string {
  if (evals.length === 0) return 'No staff are qualified for this position.';
  const counts = new Map<string, number>();
  let overtimeOnly = 0;
  for (const e of evals) {
    if (e.eligible) {
      overtimeOnly++;
      continue;
    }
    const label = BLOCK_LABEL[e.blocks[0]!.code] ?? e.blocks[0]!.code.toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`);
  if (overtimeOnly) parts.push(`${overtimeOnly} would go into overtime`);
  return `${evals.length} candidate${evals.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

