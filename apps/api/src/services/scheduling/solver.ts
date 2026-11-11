/**
 * "Fill the schedule": a whole-week solver. Pure, deterministic for a given seed, no database.
 *
 * Model. Each open draft shift in the run is a slot; the solver picks at most one person per slot.
 *  Hard rules (never broken in the result):
 *   - qualified: holds the position, every required certification verified and valid through the
 *     shift (with prerequisites), blocking onboarding done, old enough;
 *   - available: inside submitted availability, not on approved time off, not already working,
 *     enough travel time between facilities;
 *   - labour rules: rest between shifts and daily rest (provincial rules of the slot's facility),
 *     personal weekly cap, young-worker limits, hours of service, work restrictions, the
 *     organization's max hours a day and max consecutive days, and no overtime when "avoid
 *     overtime" is on.
 *  Soft goals (a weighted cost, lower is better; weights 0–10 per organization/department):
 *   fill every slot first, then required coverage (e.g. a certified operator on site), then
 *   contracted/target hours, fair hours across the horizon, overtime cost and the overtime
 *   ledger, weekends/evenings rotation, continuity (same facility, keep existing drafts),
 *   preferences (main position, people who confirmed availability for tentative weeks, and the
 *   shifts people said they'd prefer or avoid and the most hours/days a week they'd like) and —
 *   only when the organization and department use it — seniority. With seniority off, it is
 *   never read: not as a weight, a tie-break or a reason.
 *
 * Algorithm.
 *  1. Static screen once per (person, slot): position, certifications, onboarding, age, time off,
 *     availability, restrictions. Cheap, and only ever removes people the full check would refuse.
 *  2. Greedy construction, hardest slot first (fewest qualified people, then earliest), each slot
 *     to the person whose cost rises least; ties by fewest hours so far, then a seeded order
 *     (never alphabetical or by hire date).
 *  3. Local search (simulated annealing, seeded): reassign, swap two people's shifts, and
 *     "move and back-fill" chains to fill a slot that is still open. Stops at an iteration budget
 *     (reproducible) or the time budget, whichever is first.
 *  4. Verification: every proposed shift is re-checked with evaluateCandidate() — the same check
 *     the Shift Board and the per-shift assistant use — against all of that person's other shifts.
 *     Anything it refuses is dropped and the slot re-tried, so the result can never break a rule
 *     the rest of the product enforces.
 *  5. Explanations: why each person (and the next three alternatives), and for each open slot how
 *     many qualified people there are and what stops each of them.
 *
 * The fast rule checks in steps 2–3 are a model of the compliance rules; step 4 is the authority.
 */
import { Decimal } from '../../lib/money.js';
import { type Interval, localDate, payWeekStart, splitByLocalDay } from '../../lib/time.js';
import { type ProvinceRules, maxConsecutiveDaysAllowed } from '../compliance/provincialRules.js';
import type { DayDefinition } from '../compliance/workDay.js';
import { accommodationBlocks } from '../people/accommodation.js';
import type { EmploymentStatus } from './assistant.js';
import { type CandidateContext, type PositionSpec, type SchoolCalendar, type ShiftSpec, availableAt, checkDailyRest, checkRestBetweenShifts, checkWeeklyRest, consecutiveDays, evaluateCandidate, wallMinutes } from './eligibility.js';
import type { SolverWeights } from './solverSettings.js';
import { breakWindow } from './workRules.js';
import { type StatedPreferences, hasStated, preferenceScore } from './preferences.js';
import { twoPersonViolations } from './twoPerson.js';

export interface SolverSlot {
  id: string;
  shift: ShiftSpec & { facilityId: string };
  position: PositionSpec;
  rules: ProvinceRules;
  schoolCalendar?: SchoolCalendar;
  /** A draft assignee the run may change (only when "keep shifts already assigned" is off). */
  currentUserId?: string | null;
  /** Beyond the availability planning window: filled, but marked tentative. */
  tentative?: boolean;
  /** A statutory holiday (as observed) at this slot's facility: paid at the province's worked multiplier. */
  statHoliday?: boolean;
  /** Extra $/h on this shift (the manual premium plus rule premiums in $/h). */
  premiumPerHour?: number;
  /** Rule premiums as a percent of the rate, averaged over the shift's paid hours. */
  premiumPercent?: number;
  /** Never alone: at least two qualified people must overlap at the facility (twoPerson.ts). */
  neverAlone?: boolean;
}

export interface SolverPerson extends CandidateContext {
  employmentStatus: EmploymentStatus;
  /** Read only when seniority is on. */
  seniorityDate: string | null;
  seniorityHours: number;
  /** Weekly hours to aim for (contracted minimum, or the department's target for full-time staff). */
  targetHours: number | null;
  /** The person's main position (first approved); others are second positions. */
  primaryPositionId: string | null;
  /** Hourly rate by position, for the overtime cost estimate. */
  rates: ReadonlyMap<string, number>;
  /** Overtime hours charged this equalization period (the ledger). */
  overtimeCharged: number;
  /** Earlier weeks of the same horizon (already proposed or worked), for fairness across it. */
  prior: { hours: number; weekends: number; evenings: number; weeks: number; holidays?: number };
  /** Availability confirmed through this ISO date (null = never confirmed). */
  confirmedThrough: string | null;
  /** Stated shift preferences (a wish, not availability): soft, weighed with "preferences". */
  preferences?: StatedPreferences;
}

export interface CoverageNeed {
  id: string;
  name: string;
  facilityId: string;
  certificationId: string;
  /** Instead of a certificate: holding this position counts (the two-person minimum). */
  positionId?: string;
  minCount: number;
  windows: Interval[];
  /** Shifts already scheduled at the facility by certificate holders who aren't in this run. */
  covered?: Interval[];
}

export interface SolverOptions {
  weights: SolverWeights;
  useSeniority: boolean;
  avoidOvertime: boolean;
  payWeekStartDay: number;
  travelMinutes: number;
  maxConsecutiveDays: number;
  maxDailyHours: number;
  /** Hours already scheduled inside [windowStart, windowEnd) count toward fairness. */
  windowStart: Date;
  windowEnd: Date;
  seed: number;
  timeBudgetMs: number;
  /** Local-search iterations; the run is reproducible when this, not time, ends it. */
  maxIterations?: number;
  /** Skip local search (for comparisons). */
  greedyOnly?: boolean;
  defaultRate?: number;
  /** Facility → time zone, for shifts people already have elsewhere (default: the first slot's). */
  facilityTimezones?: ReadonlyMap<string, string>;
}

export interface SolverInput {
  slots: SolverSlot[];
  people: SolverPerson[];
  coverage?: CoverageNeed[];
  /**
   * Shifts of people outside the run at the run's facilities, with the positions they hold: they
   * count as the second person for never-alone shifts.
   */
  companions?: Array<{ id: string; userId: string; facilityId: string; positionId: string; start: Date; end: Date; qualifiedPositionIds: ReadonlySet<string> }>;
  options: SolverOptions;
}

export interface Why {
  code: string;
  params?: Record<string, string | number>;
}

export interface Proposal {
  slotId: string;
  userId: string;
  previousUserId: string | null;
  /** Hours this week before this shift, and after all proposals. */
  hoursBefore: number;
  weekHours: number;
  overtimeHours: number;
  tentative: boolean;
  reasons: Why[];
  alternatives: Array<{ userId: string; hoursBefore: number; overtimeHours: number; reasons: Why[] }>;
}

export interface Unfilled {
  slotId: string;
  /** People who hold the position. */
  qualified: number;
  /** What stops them, most common first. */
  counts: Array<{ code: string; count: number }>;
  /** Someone who could work it with overtime (when overtime is avoided). */
  overtimeOption: { userId: string; overtimeHours: number } | null;
}

export interface SolverResult {
  proposals: Proposal[];
  unfilled: Unfilled[];
  coverageGaps: Array<{ needId: string; name: string; shortHours: number }>;
  people: Array<{ userId: string; hours: number; weekends: number; evenings: number; holidays: number }>;
  summary: {
    slots: number;
    filled: number;
    tentative: number;
    overtimeHours: number;
    overtimeCost: number;
    /** Hours per person over the horizon so far, across everyone who could work in the run. */
    hours: { people: number; mean: number; stdev: number; min: number; max: number };
    greedy: { filled: number; cost: number; stdev: number };
    cost: number;
    iterations: number;
    ms: number;
    stoppedBy: 'iterations' | 'time' | 'converged' | 'greedy';
    /** False when the time budget, not the iteration budget, ended the search: the same seed may then differ. */
    reproducible: boolean;
    seed: number;
    droppedByVerification: number;
  };
}

// --------------------------------------------------------------------------- internals

const H = 3_600_000;
const FILL = 1000; // per open slot: filling comes first
const COVER = 60; // per short hour of required coverage
const EPS = 1e-9;

interface Piece { date: string; week: string; hours: number }
interface Iv { start: number; end: number; facilityId?: string; positionId: string; slot: number; tz: string; brk?: number }
interface SlotMeta {
  start: number;
  end: number;
  hours: number;
  pieces: Piece[];
  startDate: string;
  endDate: string;
  dow: number;
  startMin: number;
  endMin: number;
  weekend: boolean;
  evening: boolean;
  holiday: boolean;
  tz: string;
  def: DayDefinition;
  exact: boolean;
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seeded order key (FNV-1a), so ties never depend on names or hire dates. */
export function orderKey(seed: number, id: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}


const pieceMemo = new Map<string, Piece[]>();
/**
 * An interval's hours per day and pay week, in a time zone. Where the province's day for daily
 * overtime starts at a shift past midnight (BC/AB, workDay.ts), all of that shift's hours count on
 * its start date (weeks still split at the pay-week boundary). A fast model: the shared evaluator
 * verifies every proposal with the exact day windows.
 */
function piecesOf(iv: { start: number; end: number; brk?: number }, tz: string, payWeekStartDay: number, def: DayDefinition = 'calendar'): Piece[] {
  const k = `${iv.start}|${iv.end}|${tz}|${payWeekStartDay}|${def}|${iv.brk ?? 0}`;
  let v = pieceMemo.get(k);
  if (v === undefined) {
    // Paid hours only: an unpaid meal break comes out of the day it falls in.
    const w = iv.brk ? breakWindow(new Date(iv.start), new Date(iv.end), iv.brk, null) : null;
    const spans = w ? [{ start: new Date(iv.start), end: w.start }, { start: w.end, end: new Date(iv.end) }] : [{ start: new Date(iv.start), end: new Date(iv.end) }];
    const parts = spans.flatMap((x) => splitByLocalDay(x, tz));
    const first = parts[0]?.localDate;
    v = parts.map((p) => ({ date: def === 'shift_start_past_midnight' && first ? first : p.localDate, week: payWeekStart(p.localDate, payWeekStartDay), hours: (p.end.getTime() - p.start.getTime()) / H }));
    if (pieceMemo.size > 50_000) pieceMemo.clear();
    pieceMemo.set(k, v);
  }
  return v;
}

/** Whole years from one ISO date to another (age), without luxon. */
function age(dob: string, on: string): number {
  const years = Number(on.slice(0, 4)) - Number(dob.slice(0, 4));
  return on.slice(5) < dob.slice(5) ? years - 1 : years;
}
const weekMemo = new Map<string, string>();
function weekOfDate(iso: string, startDay: number): string {
  const k = `${iso}|${startDay}`;
  let v = weekMemo.get(k);
  if (v === undefined) {
    v = payWeekStart(iso, startDay);
    if (weekMemo.size > 20_000) weekMemo.clear();
    weekMemo.set(k, v);
  }
  return v;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function solve(input: SolverInput): SolverResult {
  const t0 = Date.now();
  const o = input.options;
  const maxDays = (r: ProvinceRules) => Math.min(o.maxConsecutiveDays, maxConsecutiveDaysAllowed(r));
  const W = o.weights;
  const travelMs = o.travelMinutes * 60_000;
  const people = input.people.filter((p) => p.employmentStatus !== 'VOLUNTEER');
  const slots = input.slots;
  const nS = slots.length;
  const nP = people.length;
  const defaultTz = slots[0]?.shift.timezone ?? 'America/Toronto';
  const rates = people.flatMap((p) => [...p.rates.values()]).sort((a, b) => a - b);
  const defaultRate = o.defaultRate ?? (rates.length ? rates[Math.floor(rates.length / 2)]! : 25);
  const winStart = o.windowStart.getTime();
  const winEnd = o.windowEnd.getTime();

  // ---- slot metadata (local dates, pay weeks, evening/weekend) — computed once
  const sm: SlotMeta[] = slots.map((s) => {
    const tz = s.shift.timezone;
    const def = s.rules.overtime.dayDefinition ?? 'calendar';
    // Wall-clock minutes (DST-correct): 09:00–17:00 is 540–1020 on a changeover day too.
    const wall = wallMinutes(s.shift);
    const startDate = wall.date;
    const endDate = localDate(new Date(s.shift.end.getTime() - 1), tz);
    const dow = new Date(`${startDate}T12:00:00Z`).getUTCDay();
    return {
      start: s.shift.start.getTime(),
      end: s.shift.end.getTime(),
      // Paid hours: length − unpaid meal break.
      hours: (s.shift.end.getTime() - s.shift.start.getTime()) / H - (s.shift.breakMinutes && s.shift.breakMinutes * 60_000 < s.shift.end.getTime() - s.shift.start.getTime() ? s.shift.breakMinutes / 60 : 0),
      pieces: piecesOf({ start: s.shift.start.getTime(), end: s.shift.end.getTime(), brk: s.shift.breakMinutes ?? 0 }, tz, o.payWeekStartDay, def),
      startDate,
      endDate,
      dow,
      startMin: wall.startMin,
      endMin: wall.endMin,
      weekend: dow === 0 || dow === 6,
      evening: wall.endMin > 19 * 60,
      holiday: !!s.statHoliday,
      tz,
      def,
      exact: !!s.position.hoursOfService,
    };
  });

  // ---- people: pre-existing intervals, seeded order, seniority rank (only when on)
  // Shifts people already have keep their own facility's time zone (multi-time-zone departments).
  const tzOfFacility = (f?: string) => (f && o.facilityTimezones?.get(f)) || slots.find((x) => x.shift.facilityId === f)?.shift.timezone || defaultTz;
  const pre: Iv[][] = people.map((p) =>
    p.existingShifts.map((e) => ({ start: e.start.getTime(), end: e.end.getTime(), facilityId: e.facilityId, positionId: e.positionId, slot: -1, tz: tzOfFacility(e.facilityId), brk: e.breakMinutes ?? 0 })),
  );
  /** An interval's pieces as the slot being checked counts days (its time zone and day definition). */
  const pcs = (x: Iv, m: Pick<SlotMeta, 'tz' | 'def'>) => piecesOf(x, m.tz, o.payWeekStartDay, m.def);
  const key = people.map((p) => orderKey(o.seed, p.userId));
  const juniority = new Array<number>(nP).fill(0);
  if (o.useSeniority && W.seniority > 0 && nP > 1) {
    const order = people
      .map((p, i) => ({ i, d: p.seniorityDate ?? '9999-12-31', h: p.seniorityHours }))
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : b.h - a.h));
    order.forEach((x, r) => (juniority[x.i] = r / (nP - 1)));
  }
  const maxUnder = (r: ProvinceRules) => Math.max(0, ...r.youngWorkers.limits.map((l) => l.underAge));
  const firstDate = sm.reduce((m, x) => (x.startDate < m ? x.startDate : m), sm[0]?.startDate ?? '9999-12-31');
  const youngest = Math.max(0, ...slots.map((s) => maxUnder(s.rules)));
  const exactPerson = people.map((p) => (p.restrictions ?? []).some((r) => r.maxWeeklyHours !== null) || (!!p.dateOfBirth && age(p.dateOfBirth, firstDate) < youngest));
  // Stated preferences: +1 prefers shifts like this one, −1 would rather avoid it (per person × slot).
  const stated = people.map((p) => hasStated(p.preferences));
  const prefers = people.map((p) => !!p.preferences?.windows.some((w) => w.kind === 'PREFER'));
  const pref = new Int8Array(stated.some(Boolean) ? nP * nS : 0);
  if (pref.length) for (let i = 0; i < nP; i++) if (people[i]!.preferences?.windows.length) for (let j = 0; j < nS; j++) pref[i * nS + j] = preferenceScore(people[i]!.preferences, { dow: sm[j]!.dow, startMinute: sm[j]!.startMin, positionId: slots[j]!.shift.positionId, facilityId: slots[j]!.shift.facilityId });
  const prefOf = (i: number, j: number) => (pref.length ? pref[i * nS + j]! : 0);

  // ---- 1. static screen
  const candidates: number[][] = []; // slot → people who pass the static screen
  const staticCounts: Array<Map<string, number>> = [];
  const holdsPosition: number[] = [];
  for (let j = 0; j < nS; j++) {
    const s = slots[j]!;
    const m = sm[j]!;
    const ok: number[] = [];
    const counts = new Map<string, number>();
    let holders = 0;
    for (let i = 0; i < nP; i++) {
      const p = people[i]!;
      if (!p.qualifiedPositionIds.has(s.shift.positionId)) continue;
      holders++;
      const code = staticBlock(p, s, m);
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
      else ok.push(i);
    }
    candidates.push(ok);
    staticCounts.push(counts);
    holdsPosition.push(holders);
  }

  // ---- coverage needs: segments and which slots/people help
  const needs = (input.coverage ?? []).map((n) => {
    const relevant = slots.map((s, j) => j).filter((j) => slots[j]!.shift.facilityId === n.facilityId && n.windows.some((w) => sm[j]!.start < w.end.getTime() && sm[j]!.end > w.start.getTime()));
    const segs: Array<{ a: number; b: number; base: number; slots: number[]; holder: boolean[] }> = [];
    for (const w of n.windows) {
      // Certificates are checked on the window's own date (one that lapses mid-week stops counting).
      const wDate = localDate(w.start, defaultTz);
      const holderHere = people.map((p) => (n.positionId ? p.qualifiedPositionIds.has(n.positionId) : holdsCert(p, n.certificationId, wDate)));
      const ws = w.start.getTime();
      const we = w.end.getTime();
      const pts = new Set<number>([ws, we]);
      for (const j of relevant) for (const x of [sm[j]!.start, sm[j]!.end]) if (x > ws && x < we) pts.add(x);
      const holderPre = [
        ...people.flatMap((p, i) => (holderHere[i] ? pre[i]!.filter((iv) => iv.facilityId === n.facilityId) : [])),
        ...(n.covered ?? []).map((c) => ({ start: c.start.getTime(), end: c.end.getTime() })),
      ];
      for (const x of holderPre) for (const y of [x.start, x.end]) if (y > ws && y < we) pts.add(y);
      const sorted = [...pts].sort((a, b) => a - b);
      for (let k = 0; k < sorted.length - 1; k++) {
        const a = sorted[k]!;
        const b = sorted[k + 1]!;
        segs.push({ a, b, base: holderPre.filter((x) => x.start <= a && x.end >= b).length, slots: relevant.filter((j) => sm[j]!.start <= a && sm[j]!.end >= b), holder: holderHere });
      }
    }
    // Holds the certificate on any of the windows (for explanations).
    const holder = people.map((_, i) => segs.some((g) => g.holder[i]));
    return { n, segs, holder, relevant: new Set(relevant) };
  });
  const needsOfSlot: number[][] = slots.map((_, j) => needs.map((x, k) => (x.relevant.has(j) ? k : -1)).filter((k) => k >= 0));

  // ---- state
  const assignee = new Array<number>(nS).fill(-1);
  const mine: number[][] = people.map(() => []); // person → slots
  const version = new Array<number>(nP).fill(0);
  const exactCache = new Map<string, boolean>();

  const intervalsOf = (i: number, without = -1): Iv[] => {
    const out = [...pre[i]!];
    for (const j of mine[i]!) if (j !== without) out.push({ start: sm[j]!.start, end: sm[j]!.end, facilityId: slots[j]!.shift.facilityId, positionId: slots[j]!.shift.positionId, slot: j, tz: sm[j]!.tz, brk: slots[j]!.shift.breakMinutes ?? 0 });
    return out;
  };

  /** Fast model of the dynamic rules. Returns null when allowed, else a block code. */
  function dynamicBlock(i: number, j: number, without = -1): string | null {
    const s = slots[j]!;
    const m = sm[j]!;
    const p = people[i]!;
    const ivs = intervalsOf(i, without);
    for (const x of ivs) {
      if (x.start < m.end && x.end > m.start) return 'OVERLAPPING_SHIFT';
      if (travelMs && x.facilityId && x.facilityId !== s.shift.facilityId && m.start - x.end < travelMs && x.start - m.end < travelMs) return 'TRAVEL';
    }
    const asIntervals = ivs.map((x) => ({ start: new Date(x.start), end: new Date(x.end) }));
    if (checkRestBetweenShifts(asIntervals, s.shift, s.rules)) return 'REST_BETWEEN_SHIFTS';
    if (checkDailyRest(asIntervals, s.shift, s.rules)) return 'DAILY_REST';
    if (checkWeeklyRest(asIntervals, s.shift, s.rules, m.tz, o.payWeekStartDay)) return 'WEEKLY_REST';
    // A shift longer than the max hours a day (overnight shifts included), then hours per day and pay week.
    if (m.hours > o.maxDailyHours + EPS) return 'DAILY_HOURS';
    const day = new Map<string, number>();
    const week = new Map<string, number>();
    for (const x of ivs) for (const pc of pcs(x, m)) {
      day.set(pc.date, (day.get(pc.date) ?? 0) + pc.hours);
      week.set(pc.week, (week.get(pc.week) ?? 0) + pc.hours);
    }
    for (const pc of m.pieces) {
      day.set(pc.date, (day.get(pc.date) ?? 0) + pc.hours);
      week.set(pc.week, (week.get(pc.week) ?? 0) + pc.hours);
    }
    const ot = s.rules.overtime;
    for (const pc of m.pieces) {
      const d = day.get(pc.date)!;
      if (d > o.maxDailyHours + EPS) return 'DAILY_HOURS';
      if (o.avoidOvertime && ot.dailyHours !== null && d > ot.dailyHours + EPS) return 'OVERTIME';
    }
    const weeks = new Set(m.pieces.map((pc) => pc.week));
    for (const w of weeks) {
      const h = week.get(w)!;
      if (p.weeklyMaxHours !== null && h > Number(p.weeklyMaxHours.toString()) + EPS) return 'OVER_PERSONAL_WEEKLY_MAX';
      if (o.avoidOvertime && ot.weeklyHours !== null && h > ot.weeklyHours + EPS) return 'OVERTIME';
    }
    // Days in a row with a shift starting (each shift counts on its start date), capped by weekly rest.
    if (consecutiveDays([...asIntervals, s.shift], s.shift, m.tz) > maxDays(s.rules)) return 'CONSECUTIVE_DAYS';
    // Young workers, hours of service and weekly restrictions: the full check, cached.
    if (exactPerson[i] || m.exact) {
      const k = `${i}|${j}|${version[i]}|${without}`;
      let ok = exactCache.get(k);
      if (ok === undefined) {
        const e = exactEval(i, j, without);
        ok = e.eligible && (!o.avoidOvertime || e.overtimeHours.eq(0));
        exactCache.set(k, ok);
      }
      if (!ok) return 'RULES';
    }
    return null;
  }

  function exactEval(i: number, j: number, without = -1) {
    const p = people[i]!;
    const s = slots[j]!;
    const ctx = { ...p, existingShifts: intervalsOf(i, without).filter((x) => x.slot !== j).map((x) => ({ start: new Date(x.start), end: new Date(x.end), positionId: x.positionId, facilityId: x.facilityId, breakMinutes: x.brk ?? 0 })) };
    // The same check, with the same limits, as every other path (manual assign, Shift Board, planner).
    return evaluateCandidate(ctx, s.shift, s.position, { rules: s.rules, payWeekStartDay: o.payWeekStartDay, requireAvailability: true, schoolCalendar: s.schoolCalendar, limits: { maxDailyHours: o.maxDailyHours, maxConsecutiveDays: o.maxConsecutiveDays } });
  }

  // ---- costs
  const personStats = (i: number) => {
    const p = people[i]!;
    let hours = 0;
    let weekends = 0;
    let evenings = 0;
    let holidays = 0;
    let holidayExtra = 0;
    let premium = 0;
    let offPrimary = 0;
    let tentativeUnconfirmed = 0;
    let avoided = 0;
    let notPreferred = 0;
    let preferredMet = 0;
    const facilities = new Set<string>();
    const day = new Map<string, number>();
    const week = new Map<string, number>();
    const first = mine[i]!.length ? sm[mine[i]![0]!]! : sm[0];
    const ref = { tz: first?.tz ?? defaultTz, def: first?.def ?? ('calendar' as DayDefinition) };
    for (const x of pre[i]!) {
      if (x.end <= winStart || x.start >= winEnd) continue;
      hours += (Math.min(x.end, winEnd) - Math.max(x.start, winStart)) / H - (x.brk && x.start >= winStart && x.end <= winEnd ? x.brk / 60 : 0);
      if (x.facilityId) facilities.add(x.facilityId);
      for (const pc of pcs(x, ref)) {
        day.set(pc.date, (day.get(pc.date) ?? 0) + pc.hours);
        week.set(pc.week, (week.get(pc.week) ?? 0) + pc.hours);
      }
    }
    let rateHours = 0;
    for (const j of mine[i]!) {
      const m = sm[j]!;
      hours += m.hours;
      if (m.weekend) weekends++;
      if (m.evening) evenings++;
      const rate = p.rates.get(slots[j]!.shift.positionId) ?? defaultRate;
      if (m.holiday) {
        holidays++;
        // Hours on a statutory holiday cost the province's worked multiplier (1.5; NL 2.0).
        holidayExtra += m.hours * rate * Math.max(0, slots[j]!.rules.statutoryHoliday.workedMultiplier - 1);
      }
      // Manual and rule premiums (evening, night, weekend, holiday): $/h and % of the rate.
      premium += m.hours * ((slots[j]!.premiumPerHour ?? 0) + (rate * (slots[j]!.premiumPercent ?? 0)) / 100);
      facilities.add(slots[j]!.shift.facilityId);
      if (p.primaryPositionId && slots[j]!.shift.positionId !== p.primaryPositionId) offPrimary += m.hours;
      if (slots[j]!.tentative && !(p.confirmedThrough && p.confirmedThrough >= m.endDate)) tentativeUnconfirmed++;
      const ps = prefOf(i, j);
      if (ps < 0) avoided++;
      else if (ps > 0) preferredMet++;
      else if (prefers[i]) notPreferred++;
      rateHours += (p.rates.get(slots[j]!.shift.positionId) ?? defaultRate) * m.hours;
      for (const pc of m.pieces) {
        day.set(pc.date, (day.get(pc.date) ?? 0) + pc.hours);
        week.set(pc.week, (week.get(pc.week) ?? 0) + pc.hours);
      }
    }
    // Overtime estimate (stacked: daily excess, then weekly on the rest), with the first slot's rules;
    // hours past the daily double-time threshold (BC: 12) count at 2.0.
    let otHours = 0;
    let dtHours = 0;
    const r = (mine[i]!.length ? slots[mine[i]![0]!]! : slots[0])?.rules.overtime;
    if (r) {
      const dailyOt = new Map<string, number>();
      for (const [d, h] of day) dailyOt.set(d, r.dailyHours !== null ? Math.max(0, h - r.dailyHours) : 0);
      if (r.dailyDoubleTimeHours !== null) for (const h of day.values()) dtHours += Math.max(0, h - r.dailyDoubleTimeHours);
      const weekOf = new Map<string, number>();
      for (const [d, h] of day) {
        const w = weekOfDate(d, o.payWeekStartDay);
        weekOf.set(w, (weekOf.get(w) ?? 0) + h - dailyOt.get(d)!);
      }
      otHours = sum([...dailyOt.values()]) + (r.weeklyHours !== null ? sum([...weekOf.values()].map((h) => Math.max(0, h - r.weeklyHours!))) : 0);
    }
    const avgRate = hours > 0 && mine[i]!.length ? rateHours / sum(mine[i]!.map((j) => sm[j]!.hours)) : (p.rates.values().next().value ?? defaultRate);
    // Overtime cost in "1.5 units": double-time hours cost a third more.
    const otCost = (otHours + dtHours / 3) * avgRate * 1.5;
    // Stated limits: hours above the most they'd like this week, days above the most days they'd like.
    const pr = p.preferences;
    const overHours = pr?.maxWeeklyHours != null ? Math.max(0, hours - pr.maxWeeklyHours) : 0;
    const overDays = pr?.maxDaysPerWeek != null ? Math.max(0, new Set([...day.entries()].filter(([, h]) => h > EPS).map(([d]) => d)).size - pr.maxDaysPerWeek) : 0;
    return { hours, weekends, evenings, holidays, holidayExtra, premium, offPrimary, tentativeUnconfirmed, avoided, notPreferred, preferredMet, overHours, overDays, facilities: facilities.size, otHours, dtHours, otCost, avgRate };
  };

  const personCost = (i: number): number => {
    const p = people[i]!;
    const st = personStats(i);
    if (!mine[i]!.length) {
      // Unassigned people still carry their shortfall below target.
      const short = p.targetHours ? Math.max(0, p.targetHours - st.hours) : 0;
      return W.targetHours * 0.1 * short * short;
    }
    const target = p.targetHours ?? 0;
    const short = Math.max(0, target - st.hours);
    const horizonHours = p.prior.hours + st.hours;
    const extra = Math.max(0, horizonHours - target * (p.prior.weeks + 1));
    const assignedHours = sum(mine[i]!.map((j) => sm[j]!.hours));
    // Hours go to full-time first, then part-time, then casual and on-call staff.
    const tier = TIER[p.employmentStatus] ?? 0;
    const wk = p.prior.weekends + st.weekends;
    const ev = p.prior.evenings + st.evenings;
    const hol = (p.prior.holidays ?? 0) + st.holidays;
    return (
      W.targetHours * (0.1 * short * short + tier * assignedHours) +
      W.fairness * 0.05 * extra * extra +
      W.overtime * (0.05 * st.otCost + 0.05 * st.otHours * p.overtimeCharged + 0.05 * (st.holidayExtra + st.premium)) +
      // Weekends, evenings and statutory holidays rotate fairly.
      W.spread * 3 * (wk * wk + ev * ev + 2 * hol * hol) +
      W.continuity * 15 * Math.max(0, st.facilities - 1) +
      W.preferences * (0.5 * st.offPrimary + 4 * st.tentativeUnconfirmed + (stated[i] ? 3 * st.avoided + st.notPreferred - 1.5 * st.preferredMet + 0.3 * st.overHours * st.overHours + 4 * st.overDays : 0)) +
      (o.useSeniority ? W.seniority * 1.5 * assignedHours * juniority[i]! : 0)
    );
  };

  const slotCost = (j: number): number => {
    const a = assignee[j]!;
    if (a < 0) return FILL;
    const cur = slots[j]!.currentUserId;
    return cur && people[a]!.userId !== cur ? W.continuity * 6 : 0;
  };

  const needCost = (k: number): number => {
    const x = needs[k]!;
    let c = 0;
    for (const seg of x.segs) {
      let have = seg.base;
      for (const j of seg.slots) if (assignee[j]! >= 0 && seg.holder[assignee[j]!]) have++;
      if (have < x.n.minCount) c += (x.n.minCount - have) * ((seg.b - seg.a) / H);
    }
    return c * COVER;
  };

  const pCost = people.map(() => 0);
  const nCost = needs.map(() => 0);
  const recomputeAll = () => {
    for (let i = 0; i < nP; i++) pCost[i] = personCost(i);
    for (let k = 0; k < needs.length; k++) nCost[k] = needCost(k);
  };
  const total = () => sum(pCost) + sum(nCost) + sum(slots.map((_, j) => slotCost(j)));

  const place = (j: number, i: number) => {
    const prev = assignee[j]!;
    if (prev >= 0) {
      mine[prev] = mine[prev]!.filter((x) => x !== j);
      version[prev]!++;
    }
    assignee[j] = i;
    if (i >= 0) {
      mine[i]!.push(j);
      version[i]!++;
    }
  };

  /** Applies a set of changes, returns the cost delta and an undo. */
  function apply(changes: Array<[number, number]>): { delta: number; undo: () => void } {
    const persons = new Set<number>();
    const ns = new Set<number>();
    const before: Array<[number, number]> = changes.map(([j]) => [j, assignee[j]!]);
    for (const [j, i] of changes) {
      if (assignee[j]! >= 0) persons.add(assignee[j]!);
      if (i >= 0) persons.add(i);
      for (const k of needsOfSlot[j]!) ns.add(k);
    }
    const slotSet = [...new Set(changes.map(([j]) => j))];
    const oldP = [...persons].map((i) => pCost[i]!);
    const oldN = [...ns].map((k) => nCost[k]!);
    const oldS = sum(slotSet.map(slotCost));
    for (const [j, i] of changes) place(j, i);
    let delta = sum(slotSet.map(slotCost)) - oldS;
    [...persons].forEach((i, x) => {
      pCost[i] = personCost(i);
      delta += pCost[i]! - oldP[x]!;
    });
    [...ns].forEach((k, x) => {
      nCost[k] = needCost(k);
      delta += nCost[k]! - oldN[x]!;
    });
    return {
      delta,
      undo: () => {
        for (const [j, i] of [...before].reverse()) place(j, i);
        [...persons].forEach((i, x) => (pCost[i] = oldP[x]!));
        [...ns].forEach((k, x) => (nCost[k] = oldN[x]!));
      },
    };
  }

  const hoursSoFar = (i: number) => people[i]!.prior.hours + personStats(i).hours;

  /** Best feasible person for a slot by cost increase; ties by fewest hours so far, then seeded order. */
  function bestFor(j: number, exclude = -1, limit = Infinity): number {
    let best = -1;
    let bestDelta = Infinity;
    let bestHours = Infinity;
    let seen = 0;
    for (const i of candidates[j]!) {
      if (i === exclude || dynamicBlock(i, j)) continue;
      if (++seen > limit) break;
      const r = apply([[j, i]]);
      const d = r.delta;
      r.undo();
      const h = hoursSoFar(i);
      if (d < bestDelta - EPS || (Math.abs(d - bestDelta) <= EPS && (h < bestHours - EPS || (Math.abs(h - bestHours) <= EPS && key[i]! < key[best]!)))) {
        best = i;
        bestDelta = d;
        bestHours = h;
      }
    }
    return best;
  }

  // ---- 2. greedy: keep current drafts where allowed, then hardest first
  recomputeAll();
  for (let j = 0; j < nS; j++) {
    const cur = slots[j]!.currentUserId;
    const i = cur ? people.findIndex((p) => p.userId === cur) : -1;
    if (i >= 0 && candidates[j]!.includes(i) && !dynamicBlock(i, j)) apply([[j, i]]);
  }
  const order = slots
    .map((_, j) => j)
    .filter((j) => assignee[j]! < 0)
    .sort((a, b) => candidates[a]!.length - candidates[b]!.length || sm[a]!.start - sm[b]!.start || (slots[a]!.id < slots[b]!.id ? -1 : 1));
  for (const j of order) {
    const i = bestFor(j);
    if (i >= 0) apply([[j, i]]);
  }
  const greedyCost = total();
  const greedyFilled = assignee.filter((a) => a >= 0).length;
  const greedyStdev = stats().stdev;

  // ---- 3. local search
  const rand = rng(o.seed);
  // Size-based budget: big runs get fewer iterations per slot, so the iteration budget (reproducible
  // for a seed) rather than the clock usually ends the search. When time does, the summary says so.
  const maxIter = o.greedyOnly ? 0 : (o.maxIterations ?? Math.min(250_000, 300 * Math.max(1, nS), Math.floor(4_000_000 / Math.max(1, nP))));
  let iterations = 0;
  let stoppedBy: SolverResult['summary']['stoppedBy'] = o.greedyOnly ? 'greedy' : 'iterations';
  let cost = total();
  let best = { cost, assignee: [...assignee] };
  let sinceBest = 0;
  const T0 = 30;
  const T1 = 0.3;
  // Leave part of the budget for verification and explanations.
  const deadline = t0 + o.timeBudgetMs * 0.7;
  const movable = slots.map((_, j) => j).filter((j) => candidates[j]!.length > 0);
  while (iterations < maxIter && movable.length) {
    if ((iterations & 63) === 0 && Date.now() > deadline) {
      stoppedBy = 'time';
      break;
    }
    if (sinceBest > Math.max(20_000, 60 * nS)) {
      stoppedBy = 'converged';
      break;
    }
    iterations++;
    sinceBest++;
    const temp = T0 * Math.pow(T1 / T0, iterations / Math.max(1, maxIter));
    const j = movable[Math.floor(rand() * movable.length)]!;
    const cands = candidates[j]!;
    const c = cands[Math.floor(rand() * cands.length)]!;
    const a = assignee[j]!;
    let changes: Array<[number, number]> | null = null;
    if (c === a) continue;
    if (a < 0) {
      if (!dynamicBlock(c, j)) changes = [[j, c]];
      else if (mine[c]!.length) {
        // Move and back-fill: c leaves one of their shifts for this open one; someone else takes theirs.
        const t = mine[c]![Math.floor(rand() * mine[c]!.length)]!;
        if (dynamicBlock(c, j, t)) continue;
        changes = [[t, bestFor(t, c, 12)], [j, c]];
      }
    } else if (rand() < 0.5) {
      if (!dynamicBlock(c, j)) changes = [[j, c]];
    } else if (mine[c]!.length) {
      // Swap: a and c trade one shift each.
      const t = mine[c]![Math.floor(rand() * mine[c]!.length)]!;
      if (!candidates[t]!.includes(a)) continue;
      // Independent people: each is checked without the shift they give up.
      if (dynamicBlock(c, j, t) || dynamicBlock(a, t, j)) continue;
      changes = [[j, -1], [t, -1], [j, c], [t, a]];
    }
    if (!changes) continue;
    const r = apply(changes);
    if (r.delta < -EPS || rand() < Math.exp(-r.delta / temp)) {
      cost += r.delta;
      if (cost < best.cost - EPS) {
        best = { cost, assignee: [...assignee] };
        sinceBest = 0;
      }
    } else r.undo();
  }
  // Restore the best state found.
  for (let j = 0; j < nS; j++) if (assignee[j] !== best.assignee[j]) place(j, -1);
  for (let j = 0; j < nS; j++) if (assignee[j] !== best.assignee[j]) place(j, best.assignee[j]!);

  // ---- 4. verification with the shared evaluator, then retry dropped slots
  let dropped = 0;
  const verifyOk = (i: number, j: number) => {
    const e = exactEval(i, j);
    const ivs = intervalsOf(i, j);
    const travelBad = ivs.some((x) => travelMs && x.facilityId && x.facilityId !== slots[j]!.shift.facilityId && sm[j]!.start - x.end < travelMs && x.start - sm[j]!.end < travelMs);
    return { ok: e.eligible && (!o.avoidOvertime || e.overtimeHours.eq(0)) && !travelBad, e };
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < nP; i++) {
      for (const j of [...mine[i]!].sort((x, y) => sm[y]!.start - sm[x]!.start)) {
        if (!verifyOk(i, j).ok) {
          place(j, -1);
          dropped++;
          changed = true;
        }
      }
    }
  }
  if (dropped) {
    recomputeAll();
    for (const j of order.concat(slots.map((_, x) => x)).filter((x, k, arr) => arr.indexOf(x) === k)) {
      if (assignee[j]! >= 0) continue;
      for (const i of [...candidates[j]!].sort((x, y) => hoursSoFar(x) - hoursSoFar(y) || key[x]! - key[y]!)) {
        if (dynamicBlock(i, j)) continue;
        place(j, i);
        if (verifyOk(i, j).ok) break;
        place(j, -1);
      }
    }
  }
  // ---- 4b. two-person minimum: a never-alone shift this run fills must have a second qualified
  // person overlapping it at the facility the whole time; otherwise it stays open (TWO_PERSON).
  const twoPersonOpen = new Set<number>();
  if (slots.some((s) => s.neverAlone)) {
    const companions = input.companions ?? [];
    const qualifiedOf = new Map<string, ReadonlySet<string>>([...companions.map((c) => [c.userId, c.qualifiedPositionIds] as const), ...people.map((p) => [p.userId, p.qualifiedPositionIds] as const)]);
    for (let changed = true; changed; ) {
      changed = false;
      const list = [
        ...slots.map((s, j) => ({ id: `slot:${j}`, userId: assignee[j]! >= 0 ? people[assignee[j]!]!.userId : null, facilityId: s.shift.facilityId, positionId: s.shift.positionId, start: s.shift.start, end: s.shift.end, neverAlone: !!s.neverAlone })),
        ...people.flatMap((p, i) => pre[i]!.filter((x) => x.facilityId).map((x, k) => ({ id: `pre:${i}:${k}`, userId: p.userId, facilityId: x.facilityId!, positionId: x.positionId, start: new Date(x.start), end: new Date(x.end), neverAlone: false }))),
        ...companions.map((c) => ({ id: `c:${c.id}`, userId: c.userId, facilityId: c.facilityId, positionId: c.positionId, start: c.start, end: c.end, neverAlone: false })),
      ];
      for (const v of twoPersonViolations(list, (u, pos) => qualifiedOf.get(u)?.has(pos) ?? false)) {
        if (!v.shiftId.startsWith('slot:')) continue;
        const j = Number(v.shiftId.slice(5));
        place(j, -1);
        twoPersonOpen.add(j);
        dropped++;
        changed = true;
        break;
      }
    }
  }
  recomputeAll();
  const finalCost = total();

  // ---- 5. explanations
  function stats() {
    const pool = people.map((_, i) => i).filter((i) => candidates.some((c) => c.includes(i)));
    const hs = pool.map((i) => people[i]!.prior.hours + personStats(i).hours);
    const mean = hs.length ? sum(hs) / hs.length : 0;
    const stdev = hs.length ? Math.sqrt(sum(hs.map((h) => (h - mean) ** 2)) / hs.length) : 0;
    return { people: hs.length, mean: round(mean), stdev: round(stdev), min: round(hs.length ? Math.min(...hs) : 0), max: round(hs.length ? Math.max(...hs) : 0) };
  }

  /** Hours this person works in the run's window before this shift starts ("so far this week"). */
  const hoursBeforeSlot = (i: number, j: number) =>
    round(sum(intervalsOf(i, j).filter((x) => x.start < sm[j]!.start && x.end > winStart && x.start < winEnd).map((x) => (Math.min(x.end, winEnd, sm[j]!.start) - Math.max(x.start, winStart)) / H)));
  const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : 0);
  const reasonsFor = (i: number, j: number, others: number[]): Why[] => {
    const p = people[i]!;
    const s = slots[j]!;
    const m = sm[j]!;
    const st = personStats(i);
    const out: Why[] = [{ code: 'QUALIFIED_AVAILABLE', params: { hours: hoursBeforeSlot(i, j) } }];
    if (s.currentUserId === p.userId) out.push({ code: 'KEPT' });
    if (candidates[j]!.length === 1) out.push({ code: 'ONLY_OPTION' });
    if (p.targetHours && st.hours <= p.targetHours + EPS) out.push({ code: 'BELOW_TARGET', params: { target: p.targetHours } });
    const covers = needsOfSlot[j]!.filter((k) => needs[k]!.holder[i]);
    if (covers.length) out.push({ code: 'HOLDS_COVERAGE', params: { name: needs[covers[0]!]!.n.name } });
    if (pre[i]!.some((x) => x.facilityId === s.shift.facilityId) || mine[i]!.some((x) => x !== j && slots[x]!.shift.facilityId === s.shift.facilityId)) out.push({ code: 'SAME_FACILITY' });
    const otherStats = others.map((x) => personStats(x));
    if (m.weekend && people[i]!.prior.weekends + st.weekends <= minOf(otherStats.map((x, k) => people[others[k]!]!.prior.weekends + x.weekends)) + 1) out.push({ code: 'FEWEST_WEEKENDS' });
    if (m.evening && people[i]!.prior.evenings + st.evenings <= minOf(otherStats.map((x, k) => people[others[k]!]!.prior.evenings + x.evenings)) + 1) out.push({ code: 'FEWEST_EVENINGS' });
    if (p.primaryPositionId && p.primaryPositionId !== s.shift.positionId) out.push({ code: 'SECOND_POSITION' });
    // Stated preferences: honoured, or not (and why it went to them anyway shows in the other reasons).
    if (stated[i]) {
      const ps = prefOf(i, j);
      if (ps > 0) out.push({ code: 'PREFERENCE_MET' });
      else if (ps < 0) out.push({ code: 'PREFERENCE_AVOIDED' });
      else if (prefers[i]) out.push({ code: 'PREFERENCE_OUTSIDE' });
      if (st.overHours > EPS) out.push({ code: 'PREFERENCE_OVER_HOURS', params: { hours: p.preferences!.maxWeeklyHours! } });
      if (st.overDays > 0) out.push({ code: 'PREFERENCE_OVER_DAYS', params: { days: p.preferences!.maxDaysPerWeek! } });
    }
    if (st.otHours > EPS) out.push({ code: 'OVERTIME', params: { hours: round(st.otHours) } });
    if (st.otHours > EPS && others.every((x) => people[x]!.overtimeCharged >= p.overtimeCharged)) out.push({ code: 'FEWEST_OVERTIME' });
    if (o.useSeniority && W.seniority > 0 && others.every((x) => juniority[x]! >= juniority[i]!)) out.push({ code: 'SENIORITY' });
    if (s.tentative) out.push({ code: p.confirmedThrough && p.confirmedThrough >= m.endDate ? 'CONFIRMED' : 'TENTATIVE' });
    if (m.holiday) out.push({ code: 'STAT_HOLIDAY' });
    // Without a date of birth, minimum-age and young-worker rules couldn't be checked.
    if (!p.dateOfBirth) out.push({ code: 'DOB_MISSING' });
    return out;
  };

  const proposals: Proposal[] = [];
  for (let j = 0; j < nS; j++) {
    const i = assignee[j]!;
    if (i < 0) continue;
    if (slots[j]!.currentUserId === people[i]!.userId && slots[j]!.currentUserId) {
      // Unchanged draft: nothing to propose.
      continue;
    }
    // Alternatives: others who could take it as things stand, cheapest first.
    place(j, -1);
    const alts: Array<{ i: number; d: number }> = [];
    for (const c of candidates[j]!) {
      if (c === i || dynamicBlock(c, j)) continue;
      const r = apply([[j, c]]);
      alts.push({ i: c, d: r.delta });
      r.undo();
    }
    place(j, i);
    alts.sort((a, b) => a.d - b.d || hoursSoFar(a.i) - hoursSoFar(b.i) || key[a.i]! - key[b.i]!);
    const top = alts.slice(0, 3).map((x) => x.i);
    const st = personStats(i);
    proposals.push({
      slotId: slots[j]!.id,
      userId: people[i]!.userId,
      previousUserId: slots[j]!.currentUserId ?? null,
      hoursBefore: hoursBeforeSlot(i, j),
      weekHours: round(st.hours),
      overtimeHours: round(st.otHours),
      tentative: !!slots[j]!.tentative,
      reasons: reasonsFor(i, j, top),
      alternatives: top.map((c) => {
        place(j, c);
        const cs = personStats(c);
        const out = { userId: people[c]!.userId, hoursBefore: hoursBeforeSlot(c, j), overtimeHours: round(cs.otHours), reasons: reasonsFor(c, j, [i, ...top.filter((x) => x !== c)]) };
        place(j, i);
        return out;
      }),
    });
  }

  let exactBudget = 3000;
  const unfilled: Unfilled[] = [];
  for (let j = 0; j < nS; j++) {
    if (assignee[j]! >= 0) continue;
    const counts = new Map(staticCounts[j]!);
    // Left open by the two-person minimum: that is the reason, whoever could otherwise take it.
    if (twoPersonOpen.has(j)) counts.set('TWO_PERSON', Math.max(1, candidates[j]!.length));
    let overtimeOption: Unfilled['overtimeOption'] = null;
    for (const i of twoPersonOpen.has(j) ? [] : candidates[j]!) {
      let code = dynamicBlock(i, j) ?? 'RULES';
      if ((code === 'RULES' || code === 'OVERTIME') && exactBudget-- > 0) {
        const e = exactEval(i, j);
        if (e.eligible && e.overtimeHours.gt(0)) {
          code = 'OVERTIME';
          const h = Number(e.overtimeHours.toString());
          if (!overtimeOption || h < overtimeOption.overtimeHours || (h === overtimeOption.overtimeHours && people[i]!.overtimeCharged < (people.find((x) => x.userId === overtimeOption!.userId)?.overtimeCharged ?? Infinity))) {
            overtimeOption = { userId: people[i]!.userId, overtimeHours: round(h) };
          }
        } else if (!e.eligible) code = e.blocks[0]!.code;
      }
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    unfilled.push({
      slotId: slots[j]!.id,
      qualified: holdsPosition[j]!,
      counts: [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      overtimeOption,
    });
  }

  const coverageGaps = needs.map((x, k) => ({ needId: x.n.id, name: x.n.name, shortHours: round(needCost(k) / COVER) })).filter((g) => g.shortHours > 0);
  let overtimeHours = 0;
  let overtimeCost = 0;
  const peopleOut = people.map((p, i) => {
    const st = personStats(i);
    if (mine[i]!.length) {
      overtimeHours += st.otHours;
      overtimeCost += st.otCost;
    }
    return { userId: p.userId, hours: round(p.prior.hours + st.hours), weekends: p.prior.weekends + st.weekends, evenings: p.prior.evenings + st.evenings, holidays: (p.prior.holidays ?? 0) + st.holidays };
  });

  return {
    proposals,
    unfilled,
    coverageGaps,
    people: peopleOut,
    summary: {
      slots: nS,
      filled: assignee.filter((a) => a >= 0).length,
      tentative: proposals.filter((p) => p.tentative).length,
      overtimeHours: round(overtimeHours),
      overtimeCost: Math.round(overtimeCost * 100) / 100,
      hours: stats(),
      greedy: { filled: greedyFilled, cost: Math.round(greedyCost), stdev: greedyStdev },
      cost: Math.round(finalCost),
      iterations,
      ms: Date.now() - t0,
      stoppedBy,
      reproducible: stoppedBy !== 'time',
      seed: o.seed,
      droppedByVerification: dropped,
    },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Cost per assigned hour by employment status (weighted by "contracted hours first"). */
const TIER: Partial<Record<EmploymentStatus, number>> = { FULL_TIME: 0, PART_TIME: 0.15, CASUAL: 0.35, ON_CALL: 0.5 };

function holdsCert(p: CandidateContext, certId: string, onDate: string): boolean {
  if (!p.certExpiry.has(certId)) return false;
  const exp = p.certExpiry.get(certId) ?? null;
  return exp === null || exp >= onDate;
}

/** The rules that don't depend on other assignments. Null = passes. */
function staticBlock(p: SolverPerson, s: SolverSlot, m: SlotMeta): string | null {
  if (p.status !== 'ACTIVE') return 'NOT_ACTIVE';
  for (const certId of s.position.requiredCertIds) {
    if (!p.certExpiry.has(certId)) return 'MISSING_CERTIFICATION';
    if (!holdsCert(p, certId, m.endDate)) return 'CERTIFICATION_EXPIRES';
    for (const pre of s.position.prerequisites.get(certId) ?? []) if (!holdsCert(p, pre, m.endDate)) return 'PREREQUISITE_LAPSED';
  }
  for (const item of s.position.blockingOnboarding ?? []) {
    const exp = p.onboardingValid?.get(item.id);
    if (exp === undefined || (exp !== null && exp < m.endDate)) return 'ONBOARDING_INCOMPLETE';
  }
  if (p.dateOfBirth) {
    const years = age(p.dateOfBirth, m.startDate);
    if (years < Math.max(s.position.minimumAge ?? 0, s.rules.youngWorkers.minimumAge)) return 'UNDER_MINIMUM_AGE';
  }
  if (p.approvedTimeOff.some((t) => t.start.getTime() < m.end && t.end.getTime() > m.start)) return 'ON_APPROVED_TIME_OFF';
  if (!availableAt(p.availability, m.startDate, m.startMin, m.endMin)) return 'NOT_AVAILABLE';
  if ((p.restrictions ?? []).length && accommodationBlocks(p.restrictions!, { start: s.shift.start, end: s.shift.end, positionId: s.shift.positionId, timezone: s.shift.timezone }, new Decimal(0)).length) return 'ACCOMMODATION';
  return null;
}
