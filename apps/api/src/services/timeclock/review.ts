/**
 * Punch review: supervisors approve or reject closed punches before payroll.
 * Variance against the scheduled shift is computed so the queue can sort the
 * punches that need a look (late, early, off-site, unscheduled) to the top.
 */
import type { PunchLocationStatus } from '../../generated/prisma/client.js';
import { type Tx, audit } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';
import { OFFLINE_RULES } from './punches.js';

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
  const own = punches.filter((p) => p.userId === actor.userId);
  if (own.length) throw badRequest('You cannot review your own punches.');

  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await tx.timePunch.updateMany({
    where: { id: { in: ids } },
    data: { status, reviewedById: actor.userId, reviewedAt: new Date(), ...(note ? { varianceReason: note } : {}) },
  });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: `punch.${decision.toLowerCase()}`, entity: 'TimePunch', after: { ids, note } });
  return { updated: punches.length, rejectedUserIds: status === 'REJECTED' ? [...new Set(punches.map((p) => p.userId))] : [] };
}
