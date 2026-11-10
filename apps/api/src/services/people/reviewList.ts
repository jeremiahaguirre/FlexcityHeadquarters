import type { Tx } from '../../lib/db.js';
import { computeReliability } from '../reliability/score.js';
import { type Review, review } from './review.js';

const YEAR = 366 * 86_400_000;

export interface ReviewRow {
  id: string;
  tenantId: string;
  name: string;
  roles: string[];
  score: number;
  flaggedSince: Date | null;
  review: Review;
}

/** Everyone active, with their review, loaded in a handful of queries. */
/** `onlyBy`: a supervisor who isn't HR sees only people they made records about, built from those records. */
export async function reviewList(tx: Tx, now = new Date(), onlyBy: string | null = null): Promise<ReviewRow[]> {
  const since = new Date(now.getTime() - YEAR);
  const [users, events, leave, notes, records] = await Promise.all([
    tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null }, select: { id: true, tenantId: true, firstName: true, lastName: true, roles: true, reviewFlaggedAt: true } }),
    tx.reliabilityEvent.findMany({ where: { occurredAt: { gte: since }, ...(onlyBy ? { recordedById: onlyBy } : {}) } }),
    tx.timeOffRequest.findMany({ where: { endsAt: { gte: since } } }),
    tx.conductNote.findMany({ where: { occurredAt: { gte: since }, ...(onlyBy ? { recordedById: onlyBy } : {}) } }),
    tx.disciplinaryRecord.findMany({ where: onlyBy ? { issuedById: onlyBy } : {}, select: { userId: true, level: true, issuedAt: true, acknowledgedAt: true } }),
  ]);
  const involved = onlyBy ? new Set([...events, ...notes, ...records].map((r) => r.userId)) : null;
  const by = <T extends { userId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.userId, [...(m.get(r.userId) ?? []), r]);
    return m;
  };
  const [ev, lv, nt, rc] = [by(events), by(leave), by(notes), by(records)];
  return users
    .filter((u) => !involved || involved.has(u.id))
    .map((u) => {
      const s = computeReliability(ev.get(u.id) ?? [], lv.get(u.id) ?? [], now);
      return {
        id: u.id,
        tenantId: u.tenantId,
        name: `${u.firstName} ${u.lastName}`,
        roles: u.roles,
        score: s.score,
        flaggedSince: u.reviewFlaggedAt,
        review: review({ score: s.score, counted: s.counted, excludedCount: s.excluded.length, notes: nt.get(u.id) ?? [], records: rc.get(u.id) ?? [] }, now),
      };
    })
    .sort((a, b) => Number(b.review.attention) - Number(a.review.attention) || b.review.flags.length - a.review.flags.length || a.score - b.score || a.name.localeCompare(b.name));
}
