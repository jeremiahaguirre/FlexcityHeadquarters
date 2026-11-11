/**
 * Loads what the reliability score is computed from, so every screen (the
 * person's file, the case file, the people review and its flags, the HR
 * overview, the nightly stored score, reports) uses one computation.
 *
 * The organization's recovery choice is kept in Tenant.retentionSettings under
 * `reliability`: { mode: 'GRADUAL' | 'RESET' | 'BOTH', resetMonth, resetDay }
 * (how long attendance events keep counting). Missing = gradual recovery.
 * Computed on read: a yearly restart needs no job and nothing is rewritten.
 */
import type { Tx } from '../../lib/db.js';
import { type ReliabilityPolicy, type ScoreBreakdown, type ScoreEvent, type ScoreLeave, type ScoreNote, type ScoreShift, WINDOW_DAYS, computeReliability, lastRestart, readPolicy } from './score.js';

const DAY = 86_400_000;

export async function reliabilityPolicy(tx: Tx): Promise<ReliabilityPolicy> {
  const [t, facility] = await Promise.all([
    tx.tenant.findFirst({ select: { retentionSettings: true } }),
    tx.facility.findFirst({ orderBy: { createdAt: 'asc' }, select: { timezone: true } }),
  ]);
  const raw = t?.retentionSettings && typeof t.retentionSettings === 'object' ? (t.retentionSettings as Record<string, unknown>).reliability : undefined;
  return readPolicy(raw, facility?.timezone);
}

/** The earliest moment that can still count under this policy. */
export function countsSince(policy: ReliabilityPolicy, now: Date): Date {
  const window = new Date(now.getTime() - (WINDOW_DAYS + 1) * DAY);
  if (policy.mode === 'GRADUAL') return window;
  const restart = lastRestart(now, policy);
  return policy.mode === 'RESET' ? restart : new Date(Math.max(window.getTime(), restart.getTime()));
}

export interface ScoreInputs {
  events: ScoreEvent[];
  leave: ScoreLeave[];
  shifts: ScoreShift[];
  notes: ScoreNote[];
}

/**
 * Inputs for some people (or everyone active when `userIds` is null).
 * `onlyBy`: a supervisor who isn't HR, who sees only the records they made; the score then covers
 * only those (their own attendance records and commendations), not timeclock credits.
 */
export async function loadScoreInputs(tx: Tx, userIds: string[] | null, policy: ReliabilityPolicy, now: Date, onlyBy: string | null = null): Promise<Map<string, ScoreInputs>> {
  const since = countsSince(policy, now);
  const who = userIds ? { userId: { in: userIds } } : {};
  const credits = policy.mode !== 'RESET';
  const [events, leave, punches, notes] = await Promise.all([
    tx.reliabilityEvent.findMany({ where: { ...who, occurredAt: { gte: since, lte: now }, ...(onlyBy ? { recordedById: onlyBy } : {}) }, select: { id: true, userId: true, type: true, occurredAt: true, excludedReason: true, sourceId: true } }),
    tx.timeOffRequest.findMany({ where: { ...who, endsAt: { gte: since } }, select: { userId: true, type: true, status: true, startsAt: true, endsAt: true } }),
    credits && !onlyBy
      ? tx.timePunch.findMany({ where: { ...who, clockIn: { gte: since, lte: now }, clockOut: { not: null }, status: { not: 'REJECTED' } }, select: { id: true, userId: true, clockIn: true } })
      : Promise.resolve([] as Array<{ id: string; userId: string; clockIn: Date }>),
    credits
      ? tx.conductNote.findMany({ where: { ...who, category: 'COMMENDATION', retractedAt: null, occurredAt: { gte: since, lte: now }, ...(onlyBy ? { recordedById: onlyBy } : {}) }, select: { id: true, userId: true, category: true, occurredAt: true, retractedAt: true } })
      : Promise.resolve([] as Array<ScoreNote & { userId: string }>),
  ]);
  const out = new Map<string, ScoreInputs>();
  const of = (id: string) => {
    let v = out.get(id);
    if (!v) out.set(id, (v = { events: [], leave: [], shifts: [], notes: [] }));
    return v;
  };
  for (const id of userIds ?? []) of(id);
  for (const e of events) of(e.userId).events.push(e);
  for (const l of leave) of(l.userId).leave.push(l);
  for (const p of punches) of(p.userId).shifts.push({ id: p.id, at: p.clockIn });
  for (const n of notes) of(n.userId).notes.push(n);
  return out;
}

export const scoreOf = (inputs: ScoreInputs | undefined, policy: ReliabilityPolicy, now: Date): ScoreBreakdown =>
  computeReliability(inputs?.events ?? [], inputs?.leave ?? [], now, { policy, shifts: inputs?.shifts ?? [], notes: inputs?.notes ?? [] });

/** One person's explained score. */
export async function loadReliability(tx: Tx, userId: string, now = new Date(), onlyBy: string | null = null): Promise<ScoreBreakdown> {
  const policy = await reliabilityPolicy(tx);
  const inputs = await loadScoreInputs(tx, [userId], policy, now, onlyBy);
  return scoreOf(inputs.get(userId), policy, now);
}
