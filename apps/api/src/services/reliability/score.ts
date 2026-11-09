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
 */
import type { ReliabilityEventType, TimeOffType } from '@prisma/client';

export const WINDOW_DAYS = 90;

export const POINTS: Record<ReliabilityEventType, number> = {
  NO_SHOW: -15,
  LATE_DROP: -5,
  MISSED_IN_SERVICE: -5,
  LATE_PUNCH: -2,
  PICKED_UP_SHIFT: 2,
};

const PROTECTED: ReadonlySet<TimeOffType> = new Set(['SICK', 'PROTECTED_LEAVE']);

export interface ScoreEvent {
  id: string;
  type: ReliabilityEventType;
  occurredAt: Date;
  excludedReason: string | null;
}

export interface ScoreLeave {
  type: TimeOffType;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';
  startsAt: Date;
  endsAt: Date;
}

export interface ScoreBreakdown {
  score: number;
  counted: Array<{ id: string; type: ReliabilityEventType; points: number; occurredAt: Date }>;
  excluded: Array<{ id: string; type: ReliabilityEventType; reason: string }>;
}

export function computeReliability(events: ScoreEvent[], leave: ScoreLeave[], now: Date): ScoreBreakdown {
  const from = now.getTime() - WINDOW_DAYS * 86_400_000;
  const counted: ScoreBreakdown['counted'] = [];
  const excluded: ScoreBreakdown['excluded'] = [];

  for (const e of events) {
    const t = e.occurredAt.getTime();
    if (t < from || t > now.getTime()) continue;
    if (e.excludedReason) {
      excluded.push({ id: e.id, type: e.type, reason: e.excludedReason });
      continue;
    }
    const negative = POINTS[e.type] < 0;
    const onProtectedLeave = leave.some(
      (l) => l.status !== 'DENIED' && l.status !== 'CANCELLED' && PROTECTED.has(l.type) && l.startsAt.getTime() <= t && l.endsAt.getTime() >= t,
    );
    if (negative && onProtectedLeave) {
      excluded.push({ id: e.id, type: e.type, reason: 'Overlaps protected leave' });
      continue;
    }
    counted.push({ id: e.id, type: e.type, points: POINTS[e.type], occurredAt: e.occurredAt });
  }

  const raw = 100 + counted.reduce((s, c) => s + c.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), counted, excluded };
}
