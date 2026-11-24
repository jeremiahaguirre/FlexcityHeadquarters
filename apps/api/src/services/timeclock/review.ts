/**
 * Punch review: supervisors approve or reject closed punches before payroll.
 * Variance against the scheduled shift is computed so the queue can sort the
 * punches that need a look (late, early, off-site, unscheduled) to the top.
 */
import type { PunchLocationStatus } from '../../generated/prisma/client.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict } from '../../lib/errors.js';
import { OFFLINE_RULES, assertPeriodOpen } from './punches.js';

export interface VarianceInput {
  clockIn: Date;
  clockOut: Date | null;
  shift: { startsAt: Date; endsAt: Date } | null;
  locationStatus: PunchLocationStatus;
  recordedOffline?: boolean;
  clockSkewS?: number | null;
}

export interface Variance {
  startMinutes: number | null; // + = late
  endMinutes: number | null; // + = stayed late
  attention: string[];
}

const TOLERANCE_MIN = 7;

export function punchVariance(p: VarianceInput): Variance {
  const attention: string[] = [];
  const startMinutes = p.shift ? Math.round((p.clockIn.getTime() - p.shift.startsAt.getTime()) / 60_000) : null;
  const endMinutes = p.shift && p.clockOut ? Math.round((p.clockOut.getTime() - p.shift.endsAt.getTime()) / 60_000) : null;
  if (!p.shift) attention.push('UNSCHEDULED');
  if (startMinutes !== null && startMinutes > TOLERANCE_MIN) attention.push('LATE_START');
  if (endMinutes !== null && endMinutes < -TOLERANCE_MIN) attention.push('LEFT_EARLY');
  if (endMinutes !== null && endMinutes > TOLERANCE_MIN) attention.push('STAYED_LATE');
  if (!p.clockOut) attention.push('NO_CLOCK_OUT');
  if (p.locationStatus === 'OUTSIDE_RADIUS') attention.push('OUTSIDE_GEOFENCE');
  if (p.locationStatus === 'LOW_ACCURACY' || p.locationStatus === 'NO_LOCATION') attention.push('LOCATION_UNVERIFIED');
  // Saved on the phone without a connection and sent later; and a phone clock far from the server's.
  if (p.recordedOffline) attention.push('RECORDED_OFFLINE');
  if (p.clockSkewS != null && Math.abs(p.clockSkewS) > OFFLINE_RULES.flagSkewS) attention.push('CLOCK_SKEW');
  return { startMinutes, endMinutes, attention };
}

/** Punches whose times this person added or changed since they were last reviewed. */
export async function correctedBy(tx: Tx, userId: string, punches: Array<{ id: string; reviewedAt: Date | null }>): Promise<Set<string>> {
  if (!punches.length) return new Set();
  const edits = await tx.timePunchEdit.findMany({ where: { editedById: userId, punchId: { in: punches.map((p) => p.id) } }, select: { punchId: true, createdAt: true } });
  const since = new Map(punches.map((p) => [p.id, p.reviewedAt]));
  return new Set(edits.filter((e) => { const r = since.get(e.punchId); return !r || e.createdAt > r; }).map((e) => e.punchId));
}

export async function decidePunches(
  tx: Tx,
  actor: { userId: string; tenantId: string },
  ids: string[],
  decision: 'APPROVE' | 'REJECT',
  note?: string | null,
) {
  if (decision === 'REJECT' && !note?.trim()) throw badRequest('Say why the punch is rejected; the staff member will see it.');
  const punches = await tx.timePunch.findMany({ where: { id: { in: ids } } });
  if (punches.length !== ids.length) throw badRequest('Some punches were not found.');
  const open = punches.filter((p) => !p.clockOut);
  if (decision === 'APPROVE' && open.length) throw badRequest('Punches without a clock-out cannot be approved. Fix the time first.');
  // Only punches waiting for review: a decided one goes back through a correction (which puts it back in
  // review and counts the corrector), so a rejection can't simply be overturned by whoever added the time.
  const decided = punches.filter((p) => p.status !== 'PENDING');
  if (decided.length) throw conflict('NOT_PENDING', 'Only punches waiting for review can be approved or rejected. Correct the time to send it back for review.', { ids: decided.map((p) => p.id) });
  // Time in an approved or paid pay period is settled; corrections go on the next run.
  for (const p of punches) await assertPeriodOpen(tx, p);
  const own = punches.filter((p) => p.userId === actor.userId);
  if (own.length) throw new HttpError(403, 'OWN_PUNCH', 'You can’t review your own punches. Another supervisor has to.');
  if (decision === 'APPROVE') {
    const mine = await correctedBy(tx, actor.userId, punches);
    if (mine.size) throw new HttpError(403, 'OWN_CORRECTION', 'You added or changed this time, so another supervisor has to approve it.', { ids: [...mine] });
  }

  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const { count } = await tx.timePunch.updateMany({
    where: { id: { in: ids }, status: 'PENDING' },
    data: { status, reviewedById: actor.userId, reviewedAt: new Date(), ...(note ? { varianceReason: note } : {}) },
  });
  // Someone else decided or corrected one of them at the same moment: nothing here is changed.
  if (count !== ids.length) throw conflict('NOT_PENDING', 'Some of these punches were just decided or changed by someone else. Refresh and try again.');
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: `punch.${decision.toLowerCase()}`, entity: 'TimePunch', after: { ids, note } });
  return { updated: punches.length, rejectedUserIds: status === 'REJECTED' ? [...new Set(punches.map((p) => p.userId))] : [] };
}
