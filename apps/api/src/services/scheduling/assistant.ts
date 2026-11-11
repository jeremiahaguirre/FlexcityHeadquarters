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
 *
 * How it fills a week across several facilities:
 *  1. Hardest first: at each step it takes the open shift with the FEWEST people
 *     able to work it (ties: earliest), so scarce certifications aren't used up on
 *     shifts anyone could cover. Only the person just placed is re-checked each step.
 *  2. Travel: nobody is booked at two different facilities with less than
 *     `travelMinutes` between the shifts, and among equals the person already
 *     working at that facility that week is preferred (fewer moves).
 *  3. Repair: for each shift still open, it tries moving someone from a filled
 *     shift and back-filling theirs with someone else, all within the same rules.
 * Each shift is checked against its own facility's provincial rules.
 */
import type { Decimal } from '../../lib/money.js';
import type { ProvinceRules } from '../compliance/provincialRules.js';
import {
  type OrgLimits,
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
  /** Each shift may bring its own facility's rules and school calendar; otherwise `rules` applies. */
  /** `limits`: the organization's/department's max hours a day and days in a row (as every path enforces). */
  shifts: Array<{ shift: ShiftSpec; position: PositionSpec; rules?: ProvinceRules; schoolCalendar?: SchoolCalendar; limits?: OrgLimits | null }>;
  /** Minimum gap between shifts at two different facilities (default 30). */
  travelMinutes?: number;
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
  /** Shifts filled by moving someone in the repair pass. */
  repaired: number;
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

type Item = AssistantInput['shifts'][number];
type Pooled = AssistantCandidate;

export function proposeSchedule(input: AssistantInput): AssistantOutput {
  // Work on copies: assignments made during this run feed later evaluations.
  const pool: Pooled[] = input.candidates.filter((c) => c.employmentStatus !== 'VOLUNTEER').map((c) => ({ ...c, existingShifts: [...c.existingShifts] }));
  const travelMs = (input.travelMinutes ?? 30) * 60_000;
  const evaluate = (c: Pooled, it: Item) => {
    const e = evaluateCandidate(c, it.shift, it.position, {
      rules: it.rules ?? input.rules,
      payWeekStartDay: input.payWeekStartDay,
      requireAvailability: true,
      schoolCalendar: it.schoolCalendar ?? input.schoolCalendar,
      limits: it.limits ?? null,
    });
    return { c, e, travel: !tooLittleTravel(c, it.shift, travelMs) };
  };
  const viable = (x: Scored): boolean => x.e.eligible && x.e.overtimeHours.eq(0) && x.travel !== false;

  // Who could work each open shift right now. Only the person just placed changes between steps.
  const open = new Map<string, Item>(input.shifts.map((it) => [it.shift.id, it]));
  const options = new Map<string, Map<string, Scored>>();
  for (const it of open.values()) options.set(it.shift.id, new Map(pool.map((c) => [c.userId, evaluate(c, it)])));

  const assigned = new Map<string, { item: Item; person: Pooled }>();
  const unfilledIds: string[] = [];
  while (open.size) {
    // Hardest first: fewest viable people, then earliest.
    let next: Item | null = null;
    let fewest = Infinity;
    for (const it of open.values()) {
      const n = [...options.get(it.shift.id)!.values()].filter(viable).length;
      if (n < fewest || (n === fewest && next && it.shift.start < next.shift.start)) {
        next = it;
        fewest = n;
      }
    }
    const it = next!;
    open.delete(it.shift.id);
    const choices = [...options.get(it.shift.id)!.values()].filter(viable);
    if (!choices.length) {
      unfilledIds.push(it.shift.id);
      continue;
    }
    choices.sort((x, y) => compare(x, y, input, it.shift.facilityId));
    const winner = choices[0]!.c;
    winner.existingShifts.push({ start: it.shift.start, end: it.shift.end, positionId: it.shift.positionId, facilityId: it.shift.facilityId });
    assigned.set(it.shift.id, { item: it, person: winner });
    for (const other of open.values()) options.get(other.shift.id)!.set(winner.userId, evaluate(winner, other));
  }

  // Repair: move someone from a filled shift to an open one, if another person can take theirs.
  let repaired = 0;
  const stillOpen: string[] = [];
  for (const id of unfilledIds) {
    const target = input.shifts.find((x) => x.shift.id === id)!;
    if (!tryRepair(target, assigned, pool, evaluate, viable, input)) stillOpen.push(id);
    else repaired++;
  }

  const unfilled = stillOpen.map((id) => {
    const it = input.shifts.find((x) => x.shift.id === id)!;
    return { shiftId: id, reason: explain(pool.map((c) => evaluate(c, it))) };
  });
  const assignments = input.shifts.filter((x) => assigned.has(x.shift.id)).map((x) => ({ shiftId: x.shift.id, userId: assigned.get(x.shift.id)!.person.userId }));
  return { assignments, unfilled, repaired };
}

/** Booked at another facility too close before or after this shift to get there. */
export function tooLittleTravel(c: Pick<Pooled, 'existingShifts'>, shift: ShiftSpec, travelMs: number): boolean {
  if (!shift.facilityId || !travelMs) return false;
  return c.existingShifts.some(
    (s) => s.facilityId && s.facilityId !== shift.facilityId && shift.start.getTime() - s.end.getTime() < travelMs && s.start.getTime() - shift.end.getTime() < travelMs,
  );
}

function tryRepair(
  target: Item,
  assigned: Map<string, { item: Item; person: Pooled }>,
  pool: Pooled[],
  evaluate: (c: Pooled, it: Item) => Scored,
  viable: (x: Scored) => boolean,
  input: AssistantInput,
): boolean {
  for (const [shiftId, { item, person }] of assigned) {
    // Could this person work the open shift if they gave up the one they have?
    const without = person.existingShifts.filter((s) => !(s.start.getTime() === item.shift.start.getTime() && s.positionId === item.shift.positionId && s.facilityId === item.shift.facilityId));
    const freed = { ...person, existingShifts: without };
    if (!viable(evaluate(freed, target))) continue;
    // And can someone else take the shift they leave?
    const withMoved = { ...person, existingShifts: [...without, { start: target.shift.start, end: target.shift.end, positionId: target.shift.positionId, facilityId: target.shift.facilityId }] };
    const cover = pool
      .filter((c) => c.userId !== person.userId)
      .map((c) => evaluate(c, item))
      .filter(viable)
      .sort((x, y) => compare(x, y, input, item.shift.facilityId))[0];
    if (!cover) continue;
    person.existingShifts = withMoved.existingShifts;
    cover.c.existingShifts.push({ start: item.shift.start, end: item.shift.end, positionId: item.shift.positionId, facilityId: item.shift.facilityId });
    assigned.set(target.shift.id, { item: target, person });
    assigned.set(shiftId, { item, person: cover.c });
    return true;
  }
  return false;
}

type Scored = { c: AssistantCandidate; e: ReturnType<typeof evaluateCandidate>; travel?: boolean };

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

function compare(x: Scored, y: Scored, input: AssistantInput, facilityId?: string): number {
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
  // Fewer moves: prefer whoever already works at this facility in the period.
  if (facilityId) {
    const here = (s: Scored) => s.c.existingShifts.filter((e) => e.facilityId === facilityId).length;
    const d = here(y) - here(x);
    if (d !== 0) return d;
  }
  return x.c.userId.localeCompare(y.c.userId); // deterministic
}

function explain(scored: Scored[]): string {
  if (scored.length === 0) return 'No staff are qualified for this position.';
  const evals = scored.map((s) => s.e);
  const counts = new Map<string, number>();
  let overtimeOnly = 0;
  for (const { e, travel } of scored) {
    if (e.eligible && travel === false) {
      counts.set('no time to travel between facilities', (counts.get('no time to travel between facilities') ?? 0) + 1);
      continue;
    }
    if (e.eligible) {
      overtimeOnly++;
      continue;
    }
    const label = BLOCK_LABEL[e.blocks[0]!.code] ?? e.blocks[0]!.code.toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${v} ${k}`);
  if (overtimeOnly) parts.push(`${overtimeOnly} would go into overtime`);
  return `${evals.length} candidate${evals.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

