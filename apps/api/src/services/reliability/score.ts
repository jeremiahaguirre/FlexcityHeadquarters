/**
 * Reliability score — ADVISORY ONLY.
 *
 * Safeguards (fixes to the original design):
 *  - Events overlapping SICK or PROTECTED_LEAVE time off are excluded
 *    automatically (statutory sick days, family responsibility leave, etc.).
 *  - Managers can excuse any event; excluded events stay visible with a reason.
 *  - The score is never used to schedule, tier or discipline automatically
 *    (Quebec Law 25 s.12.1; human-rights exposure elsewhere). It is shown with
 *    its full explanation, and the employee can see their own breakdown.
 *
 * How it recovers (each organization chooses, Settings › Organization):
 *  - GRADUAL (default): over the last 90 days. Deductions count in full for 60
 *    days, then at half weight until they drop off. Good attendance earns the
 *    points back: on-time completed shifts (+1, up to +4 a month), a bonus for
 *    every 10 on-time shifts in a row (+2), 30 days with nothing counted (+5),
 *    and commendations (+2, up to +4 a month).
 *  - RESET: everything since the last reset date counts in full, and the score
 *    starts again at 100 on that date every year (Jan 1, or a fiscal/season date).
 *  - BOTH: gradual recovery, and also a fresh start on the reset date.
 *
 * The score is replayed in time order and kept between 0 and 100 at every
 * step, so credits earned at 100 can't be "banked" against a later deduction.
 * Every change is returned so the file can explain each one. Sick days and
 * protected leave are neutral: they never cost points and never break a streak
 * or a clean stretch. Earlier events are never deleted; they stay on the record.
 */
import type { ConductCategory, ReliabilityEventType, TimeOffType } from '@prisma/client';
import { DateTime } from 'luxon';

/** The rolling window for gradual recovery. */
export const WINDOW_DAYS = 90;

export const POINTS: Record<ReliabilityEventType, number> = {
  NO_SHOW: -15,
  LATE_DROP: -5,
  MISSED_IN_SERVICE: -5,
  LATE_PUNCH: -2,
  PICKED_UP_SHIFT: 2,
};

/** Recovery rules, shown to people as they are (nothing hidden). */
export const RULES = {
  windowDays: WINDOW_DAYS,
  /** Deductions count in full this long, then at `fadedWeight`. */
  fullWeightDays: 60,
  fadedWeight: 0.5,
  onTimeShift: 1,
  onTimeShiftMonthlyCap: 4,
  streakLength: 10,
  streakBonus: 2,
  cleanDays: 30,
  cleanBonus: 5,
  commendation: 2,
  commendationMonthlyCap: 4,
} as const;

export const RECOVERY_MODES = ['GRADUAL', 'RESET', 'BOTH'] as const;
export type RecoveryMode = (typeof RECOVERY_MODES)[number];

export interface ReliabilityPolicy {
  mode: RecoveryMode;
  /** The yearly restart (RESET / BOTH): month 1–12 and day, local midnight in `timeZone`. */
  resetMonth: number;
  resetDay: number;
  timeZone: string;
}

export const DEFAULT_POLICY: ReliabilityPolicy = { mode: 'GRADUAL', resetMonth: 1, resetDay: 1, timeZone: 'America/Toronto' };

const DAY = 86_400_000;
const PROTECTED: ReadonlySet<TimeOffType> = new Set(['SICK', 'PROTECTED_LEAVE']);

export interface ScoreEvent {
  id: string;
  type: ReliabilityEventType;
  occurredAt: Date;
  excludedReason: string | null;
  /** The punch / offer / shift that produced it (a late clock-in names its punch). */
  sourceId?: string | null;
}

export interface ScoreLeave {
  type: TimeOffType;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';
  startsAt: Date;
  endsAt: Date;
}

/** A completed shift (a punch with a clock-out). `id` is the punch id; a LATE_PUNCH event naming it makes it late. */
export interface ScoreShift {
  id: string;
  at: Date;
  late?: boolean;
}

export interface ScoreNote {
  id: string;
  category: ConductCategory;
  occurredAt: Date;
  retractedAt: Date | null;
}

export interface ScoreOptions {
  policy?: Partial<ReliabilityPolicy> | null;
  shifts?: ScoreShift[];
  notes?: ScoreNote[];
}

/** One line of the explanation: what changed the score, when, and by how much. */
export type ScoreChange =
  | { kind: 'EVENT'; at: Date; points: number; applied: number; eventId: string; eventType: ReliabilityEventType; basePoints: number; fading: boolean }
  | { kind: 'ON_TIME'; at: Date; points: number; applied: number; month: string; count: number }
  | { kind: 'STREAK'; at: Date; points: number; applied: number; count: number }
  | { kind: 'CLEAN'; at: Date; points: number; applied: number; days: number }
  | { kind: 'COMMENDATION'; at: Date; points: number; applied: number; noteId: string }
  | { kind: 'RESTART'; at: Date; points: 0; applied: number };

export type EventStatus = 'COUNTED' | 'FADING' | 'EXCUSED' | 'PROTECTED' | 'RESTARTED' | 'AGED_OUT';

export interface ScoreBreakdown {
  score: number;
  mode: RecoveryMode;
  /** Events before this don't count (the start of the window, or the last restart). */
  countsFrom: Date;
  /** The last yearly restart, when the organization uses one. */
  restartedAt: Date | null;
  /** The next yearly restart, when the organization uses one. */
  nextRestartAt: Date | null;
  counted: Array<{ id: string; type: ReliabilityEventType; points: number; basePoints: number; fading: boolean; occurredAt: Date }>;
  excluded: Array<{ id: string; type: ReliabilityEventType; reason: string; code: 'EXCUSED' | 'PROTECTED' }>;
  /** Every event's standing, by id (also the ones that no longer count). */
  status: Record<string, EventStatus>;
  /** What moved the score, oldest first. Credits that changed nothing (already at 100) are left out. */
  changes: ScoreChange[];
  /** Ongoing on-time streak (completed shifts in a row), for "3 more for a bonus". */
  streak: number;
}

const clampDay = (y: number, m: number, d: number) => Math.min(d, DateTime.utc(y, m, 1).daysInMonth!);

/** Local midnight of the most recent reset date at or before `now` (Feb 29 falls back to Feb 28 in other years). */
export function lastRestart(now: Date, policy: Pick<ReliabilityPolicy, 'resetMonth' | 'resetDay' | 'timeZone'>): Date {
  const local = DateTime.fromJSDate(now, { zone: policy.timeZone });
  const at = (y: number) => DateTime.fromObject({ year: y, month: policy.resetMonth, day: clampDay(y, policy.resetMonth, policy.resetDay) }, { zone: policy.timeZone }).startOf('day');
  const thisYear = at(local.year);
  return (thisYear.toMillis() <= now.getTime() ? thisYear : at(local.year - 1)).toJSDate();
}

export function nextRestart(now: Date, policy: Pick<ReliabilityPolicy, 'resetMonth' | 'resetDay' | 'timeZone'>): Date {
  const last = DateTime.fromJSDate(lastRestart(now, policy), { zone: policy.timeZone });
  const y = last.year + 1;
  return DateTime.fromObject({ year: y, month: policy.resetMonth, day: clampDay(y, policy.resetMonth, policy.resetDay) }, { zone: policy.timeZone }).startOf('day').toJSDate();
}

/** Reads the stored policy defensively: anything unknown falls back to the default. */
export function readPolicy(stored: unknown, timeZone?: string | null): ReliabilityPolicy {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const mode = RECOVERY_MODES.includes(s.mode as RecoveryMode) ? (s.mode as RecoveryMode) : DEFAULT_POLICY.mode;
  const month = Number.isInteger(s.resetMonth) && (s.resetMonth as number) >= 1 && (s.resetMonth as number) <= 12 ? (s.resetMonth as number) : DEFAULT_POLICY.resetMonth;
  const maxDay = month === 2 ? 29 : DateTime.utc(2024, month, 1).daysInMonth!;
  const day = Number.isInteger(s.resetDay) && (s.resetDay as number) >= 1 && (s.resetDay as number) <= maxDay ? (s.resetDay as number) : DEFAULT_POLICY.resetDay;
  return { mode, resetMonth: month, resetDay: day, timeZone: timeZone || DEFAULT_POLICY.timeZone };
}

/** Whether an event counts against the person at all (not excused, not on sick days or protected leave). */
export function protectedAt(leave: ScoreLeave[], t: number): boolean {
  return leave.some((l) => l.status !== 'DENIED' && l.status !== 'CANCELLED' && PROTECTED.has(l.type) && l.startsAt.getTime() <= t && l.endsAt.getTime() >= t);
}

/** Why an event the score doesn't look at no longer counts: the yearly restart, or its age. */
export function notCountedStatus(at: Date, b: Pick<ScoreBreakdown, 'mode' | 'restartedAt'>, now: Date): 'RESTARTED' | 'AGED_OUT' {
  const t = at.getTime();
  const restarted = !!b.restartedAt && t < b.restartedAt.getTime();
  if (b.mode === 'RESET') return restarted ? 'RESTARTED' : 'AGED_OUT';
  return restarted && t >= now.getTime() - WINDOW_DAYS * DAY ? 'RESTARTED' : 'AGED_OUT';
}

type Item =
  | { at: number; order: 0; kind: 'EVENT'; e: ScoreEvent; base: number; points: number; fading: boolean }
  | { at: number; order: 1; kind: 'SHIFT'; s: ScoreShift; late: boolean }
  | { at: number; order: 2; kind: 'NOTE'; n: ScoreNote };

export function computeReliability(events: ScoreEvent[], leave: ScoreLeave[], now: Date, opts: ScoreOptions = {}): ScoreBreakdown {
  const policy = readPolicy(opts.policy, opts.policy?.timeZone);
  const gradual = policy.mode !== 'RESET';
  const resets = policy.mode !== 'GRADUAL';
  const nowMs = now.getTime();
  const restartedAt = resets ? lastRestart(now, policy) : null;
  const windowFrom = nowMs - WINDOW_DAYS * DAY;
  const from = policy.mode === 'GRADUAL' ? windowFrom : policy.mode === 'RESET' ? restartedAt!.getTime() : Math.max(windowFrom, restartedAt!.getTime());

  const counted: ScoreBreakdown['counted'] = [];
  const excluded: ScoreBreakdown['excluded'] = [];
  const status: ScoreBreakdown['status'] = {};
  const items: Item[] = [];
  const monthOf = (t: number) => DateTime.fromMillis(t, { zone: policy.timeZone }).toFormat('yyyy-MM');

  for (const e of events) {
    const t = e.occurredAt.getTime();
    if (t > nowMs) continue;
    if (t < from) {
      status[e.id] = notCountedStatus(e.occurredAt, { mode: policy.mode, restartedAt }, now);
      continue;
    }
    if (e.excludedReason) {
      excluded.push({ id: e.id, type: e.type, reason: e.excludedReason, code: 'EXCUSED' });
      status[e.id] = 'EXCUSED';
      continue;
    }
    const base = POINTS[e.type];
    if (base < 0 && protectedAt(leave, t)) {
      excluded.push({ id: e.id, type: e.type, reason: 'Overlaps protected leave', code: 'PROTECTED' });
      status[e.id] = 'PROTECTED';
      continue;
    }
    // Deductions fade with age under gradual recovery (rounded in the person's favour).
    const fading = gradual && base < 0 && nowMs - t > RULES.fullWeightDays * DAY;
    const points = fading ? -Math.floor(Math.abs(base) * RULES.fadedWeight) : base;
    counted.push({ id: e.id, type: e.type, points, basePoints: base, fading, occurredAt: e.occurredAt });
    status[e.id] = fading ? 'FADING' : 'COUNTED';
    items.push({ at: t, order: 0, kind: 'EVENT', e, base, points, fading });
  }

  if (gradual) {
    const lateIds = new Set(events.filter((e) => e.type === 'LATE_PUNCH' && e.sourceId).map((e) => e.sourceId!));
    for (const s of opts.shifts ?? []) {
      const t = s.at.getTime();
      if (t >= from && t <= nowMs) items.push({ at: t, order: 1, kind: 'SHIFT', s, late: !!s.late || lateIds.has(s.id) });
    }
    for (const n of opts.notes ?? []) {
      const t = n.occurredAt.getTime();
      if (n.category === 'COMMENDATION' && !n.retractedAt && t >= from && t <= nowMs) items.push({ at: t, order: 2, kind: 'NOTE', n });
    }
  }
  items.sort((a, b) => a.at - b.at || a.order - b.order);

  let score = 100;
  const changes: ScoreChange[] = [];
  const apply = (delta: number) => {
    const next = Math.max(0, Math.min(100, score + delta));
    const applied = next - score;
    score = next;
    return applied;
  };
  if (restartedAt && restartedAt.getTime() >= from) changes.push({ kind: 'RESTART', at: restartedAt, points: 0, applied: 0 });

  let streak = 0;
  let cleanFrom = from;
  const onTime = new Map<string, Extract<ScoreChange, { kind: 'ON_TIME' }>>();
  const commended = new Map<string, number>();
  const flushClean = (until: number) => {
    if (!gradual) return;
    while (cleanFrom + RULES.cleanDays * DAY <= until) {
      cleanFrom += RULES.cleanDays * DAY;
      const applied = apply(RULES.cleanBonus);
      if (applied) changes.push({ kind: 'CLEAN', at: new Date(cleanFrom), points: RULES.cleanBonus, applied, days: RULES.cleanDays });
    }
  };

  for (const it of items) {
    flushClean(it.at);
    if (it.kind === 'EVENT') {
      const applied = apply(it.points);
      changes.push({ kind: 'EVENT', at: it.e.occurredAt, points: it.points, applied, eventId: it.e.id, eventType: it.e.type, basePoints: it.base, fading: it.fading });
      if (it.points < 0) {
        streak = 0;
        cleanFrom = it.at;
      }
    } else if (it.kind === 'SHIFT') {
      // A late clock-in is handled by its own event (counted: breaks the streak; excused: neutral).
      if (it.late) continue;
      streak += 1;
      const month = monthOf(it.at);
      const entry = onTime.get(month) ?? { kind: 'ON_TIME' as const, at: new Date(it.at), points: 0, applied: 0, month, count: 0 };
      entry.count += 1;
      entry.at = new Date(it.at);
      const room = RULES.onTimeShiftMonthlyCap - entry.points;
      if (room > 0) {
        const pts = Math.min(RULES.onTimeShift, room);
        entry.points += pts;
        entry.applied += apply(pts);
      }
      if (!onTime.has(month)) {
        onTime.set(month, entry);
        changes.push(entry);
      }
      if (streak % RULES.streakLength === 0) {
        const applied = apply(RULES.streakBonus);
        if (applied) changes.push({ kind: 'STREAK', at: new Date(it.at), points: RULES.streakBonus, applied, count: streak });
      }
    } else {
      const month = monthOf(it.at);
      const used = commended.get(month) ?? 0;
      const pts = Math.min(RULES.commendation, RULES.commendationMonthlyCap - used);
      if (pts > 0) {
        commended.set(month, used + pts);
        const applied = apply(pts);
        if (applied) changes.push({ kind: 'COMMENDATION', at: it.n.occurredAt, points: pts, applied, noteId: it.n.id });
      }
    }
  }
  flushClean(nowMs);

  return {
    score,
    mode: policy.mode,
    countsFrom: new Date(from),
    restartedAt,
    nextRestartAt: resets ? nextRestart(now, policy) : null,
    counted,
    excluded,
    status,
    changes: changes.filter((c) => c.kind === 'EVENT' || c.kind === 'RESTART' || c.applied !== 0).sort((a, b) => a.at.getTime() - b.at.getTime()),
    streak,
  };
}
