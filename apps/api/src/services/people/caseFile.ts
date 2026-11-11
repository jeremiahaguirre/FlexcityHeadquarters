/**
 * An employee's case file: everything HR or a supervisor needs to act fairly,
 * in one place, built from records the app already keeps.
 */
import type { Tx } from '../../lib/db.js';
import { type EventStatus, POINTS, notCountedStatus, RULES, type RecoveryMode, type ScoreChange } from '../reliability/score.js';
import { loadReliability } from '../reliability/load.js';
import { type Review, review } from './review.js';
import { signatureCheck } from './fingerprint.js';

const YEAR = 366 * 86_400_000;

export interface CaseFile {
  /** True when the viewer isn't HR and sees only the records they made; the score then covers only those. */
  onlyMine: boolean;
  score: number;
  /** How the score got here: every change, oldest first, and the rules it follows. */
  reliability: { mode: RecoveryMode; countsFrom: Date; restartedAt: Date | null; nextRestartAt: Date | null; streak: number; changes: ScoreChange[]; rules: typeof RULES };
  review: Review;
  /** `points`: what the event counts for now (half once it's fading); `basePoints`: its full value. */
  events: Array<{ id: string; type: string; points: number; basePoints: number; status: EventStatus; occurredAt: Date; note: string | null; counted: boolean; excludedReason: string | null; source: 'TIMECLOCK' | 'SHIFT_BOARD' | 'SCHEDULE' | 'SUPERVISOR' }>;
  notes: Array<{ id: string; category: string; summary: string; occurredAt: Date; incidentId: string | null; retractedAt: Date | null; retractedReason: string | null; recordedBy: string }>;
  records: Array<{ id: string; level: string | null; summary: string; issuedAt: Date; acknowledgedAt: Date | null; stewardPresent: boolean; employeeResponse: string | null; respondedAt: Date | null; evidence: unknown }>;
}

const SOURCE = { LATE_PUNCH: 'TIMECLOCK', NO_SHOW: 'SCHEDULE', MISSED_IN_SERVICE: 'SUPERVISOR', LATE_DROP: 'SHIFT_BOARD', PICKED_UP_SHIFT: 'SHIFT_BOARD' } as const;

/** `onlyBy`: a supervisor who isn't HR sees only what they recorded or issued themselves. */
export async function loadCaseFile(tx: Tx, userId: string, now = new Date(), onlyBy: string | null = null): Promise<CaseFile> {
  const since = new Date(now.getTime() - YEAR);
  const [events, score, notes, records] = await Promise.all([
    tx.reliabilityEvent.findMany({ where: { userId, occurredAt: { gte: since }, ...(onlyBy ? { recordedById: onlyBy } : {}) }, orderBy: { occurredAt: 'desc' } }),
    loadReliability(tx, userId, now, onlyBy),
    tx.conductNote.findMany({ where: { userId, occurredAt: { gte: since }, ...(onlyBy ? { recordedById: onlyBy } : {}) }, orderBy: { occurredAt: 'desc' } }),
    tx.disciplinaryRecord.findMany({ where: { userId, ...(onlyBy ? { issuedById: onlyBy } : {}) }, orderBy: { issuedAt: 'desc' } }),
  ]);
  const countedPoints = new Map(score.counted.map((c) => [c.id, c.points]));
  const excluded = new Map(score.excluded.map((e) => [e.id, e.reason]));
  const authors = await tx.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.recordedById))] } }, select: { id: true, firstName: true, lastName: true } });
  const nameOf = (id: string) => {
    const u = authors.find((a) => a.id === id);
    return u ? `${u.firstName} ${u.lastName}` : '—';
  };
  return {
    onlyMine: !!onlyBy,
    score: score.score,
    reliability: { mode: score.mode, countsFrom: score.countsFrom, restartedAt: score.restartedAt, nextRestartAt: score.nextRestartAt, streak: score.streak, changes: score.changes, rules: RULES },
    review: review(
      {
        score: score.score,
        counted: score.counted,
        excludedCount: score.excluded.length,
        notes,
        records,
      },
      now,
    ),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      points: countedPoints.get(e.id) ?? POINTS[e.type],
      basePoints: POINTS[e.type],
      // Older than anything the score looks at: it no longer counts, and stays on the record.
      status: score.status[e.id] ?? notCountedStatus(e.occurredAt, score, now),
      occurredAt: e.occurredAt,
      note: e.note,
      counted: countedPoints.has(e.id),
      excludedReason: excluded.get(e.id) ?? null,
      source: e.recordedById ? 'SUPERVISOR' : SOURCE[e.type],
    })),
    notes: notes.map((n) => ({ id: n.id, category: n.category, summary: n.summary, occurredAt: n.occurredAt, incidentId: n.incidentId, retractedAt: n.retractedAt, retractedReason: n.retractedReason, recordedBy: nameOf(n.recordedById) })),
    records: records.map((r) => ({
      id: r.id,
      level: r.level,
      summary: r.summary,
      issuedAt: r.issuedAt,
      acknowledgedAt: r.acknowledgedAt,
      stewardPresent: r.stewardPresent,
      employeeResponse: r.employeeResponse,
      respondedAt: r.respondedAt,
      evidence: r.evidence,
      signatureCheck: signatureCheck(r as unknown as Parameters<typeof signatureCheck>[0]),
    })),
  };
}
