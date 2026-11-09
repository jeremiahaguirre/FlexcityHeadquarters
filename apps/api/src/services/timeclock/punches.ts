import { type Tx, advisoryLock, audit } from '../../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { classifyPunchLocation } from './geofence.js';

const LATE_GRACE_MINUTES = 5;

export interface PunchLocation {
  lat: number;
  lon: number;
  accuracyM: number | null;
}

export async function clockIn(
  tx: Tx,
  input: { tenantId: string; userId: string; facilityId: string; shiftId?: string; positionId?: string; location: PunchLocation | null; ip: string | null },
) {
  await advisoryLock(tx, `punch:${input.userId}`);
  const open = await tx.timePunch.findFirst({ where: { userId: input.userId, clockOut: null } });
  if (open) throw conflict('ALREADY_CLOCKED_IN', 'You are already clocked in.', { punchId: open.id });

  const facility = await tx.facility.findUnique({ where: { id: input.facilityId } });
  if (!facility) throw notFound('Facility');

  let positionId = input.positionId;
  let lateBy = 0;
  const now = new Date();
  if (input.shiftId) {
    const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
    if (!shift) throw notFound('Shift');
    if (shift.userId !== input.userId) throw forbidden('This is not your shift.');
    positionId = shift.positionId;
    lateBy = (now.getTime() - shift.startsAt.getTime()) / 60_000;
  }
  if (!positionId) throw badRequest('positionId is required for an unscheduled punch.');

  const loc = classifyPunchLocation(
    { lat: facility.latitude?.toNumber() ?? null, lon: facility.longitude?.toNumber() ?? null, radiusM: facility.geoRadiusM },
    input.location,
  );

  const punch = await tx.timePunch.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      facilityId: input.facilityId,
      shiftId: input.shiftId ?? null,
      positionId,
      clockIn: now,
      ipAddress: input.ip,
      latitude: input.location?.lat,
      longitude: input.location?.lon,
      accuracyM: input.location?.accuracyM ?? null,
      distanceM: loc.distanceM,
      locationStatus: loc.status,
    },
  });

  if (lateBy > LATE_GRACE_MINUTES) {
    await tx.reliabilityEvent.create({
      data: { tenantId: input.tenantId, userId: input.userId, type: 'LATE_PUNCH', occurredAt: now, sourceId: punch.id },
    });
  }
  return punch;
}

export async function clockOut(tx: Tx, userId: string) {
  await advisoryLock(tx, `punch:${userId}`);
  const open = await tx.timePunch.findFirst({ where: { userId, clockOut: null } });
  if (!open) throw conflict('NOT_CLOCKED_IN', 'You are not clocked in.');
  return tx.timePunch.update({ where: { id: open.id }, data: { clockOut: new Date() } });
}

/** Supervisor correction. The original value is preserved in TimePunchEdit. */
export async function editPunch(
  tx: Tx,
  input: { tenantId: string; actorId: string; punchId: string; clockIn?: Date; clockOut?: Date; reason: string },
) {
  if (!input.reason.trim()) throw badRequest('A reason is required to edit a punch.');
  const punch = await tx.timePunch.findUnique({ where: { id: input.punchId } });
  if (!punch) throw notFound('Punch');
  const next = { clockIn: input.clockIn ?? punch.clockIn, clockOut: input.clockOut ?? punch.clockOut };
  if (next.clockOut && next.clockOut <= next.clockIn) throw badRequest('Clock-out must be after clock-in.');

  for (const field of ['clockIn', 'clockOut'] as const) {
    const newVal = input[field];
    if (newVal && newVal.getTime() !== punch[field]?.getTime()) {
      await tx.timePunchEdit.create({
        data: {
          tenantId: input.tenantId,
          punchId: punch.id,
          editedById: input.actorId,
          field,
          oldValue: punch[field]?.toISOString() ?? null,
          newValue: newVal.toISOString(),
          reason: input.reason,
        },
      });
    }
  }
  const updated = await tx.timePunch.update({ where: { id: punch.id }, data: { ...next, varianceReason: input.reason } });
  await audit(tx, { tenantId: input.tenantId, actorId: input.actorId, action: 'punch.edit', entity: 'TimePunch', entityId: punch.id, before: punch, after: updated });
  return updated;
}
