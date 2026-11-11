import { announceChange } from '../../lib/changes.js';
import { type Tx, advisoryLock, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { classifyPunchLocation } from './geofence.js';

const LATE_GRACE_MINUTES = 5;

/**
 * Offline punching. A phone with no signal keeps the tap (its own id, the time it happened and the
 * location fix) and sends it when the connection returns. The server:
 * - recognises a re-sent id and answers with the punch it already saved (never a second one);
 * - corrects the time by how far the phone's clock is off (it sends its clock when it sends the punch);
 * - refuses times in the future (beyond a little clock drift) or too old to trust;
 * - flags the punch for review: supervisors see when it happened and when it arrived.
 */
export const OFFLINE_RULES = {
  /** Phone clocks drift: a punch this far "ahead" of the server is still accepted. */
  futureSkewMs: 2 * 60_000,
  /** Older than this, the supervisor adds the time instead (punch correction). */
  maxAgeMs: 72 * 3_600_000,
  /** Arriving this much after it happened counts as sent late, even if the phone didn't say so. */
  lateAfterMs: 2 * 60_000,
  /** Below this, a measured clock difference is network delay, not a wrong clock. */
  correctSkewMs: 60_000,
  /** A phone clock off by more than this is flagged for review. */
  flagSkewS: 5 * 60,
} as const;

export interface PunchTiming {
  /** The id the phone gave this tap (uuid). Re-sending it returns the punch already saved. */
  clientId?: string;
  /** When the tap happened, by the phone's clock. */
  occurredAt?: Date;
  /** The phone's clock when it sent the request, to measure how far off it is. */
  sentAt?: Date;
  /** The phone saved the punch without a connection. */
  offline?: boolean;
}

interface ResolvedTiming {
  at: Date;
  offline: boolean;
  receivedAt: Date | null;
  skewS: number | null;
}

const punchError = (code: string, msg: string) => new HttpError(422, code, msg);

/** When the punch really happened, on the server's clock, and whether it was sent late. */
export function resolveTiming(t: PunchTiming | undefined, now = new Date()): ResolvedTiming {
  if (!t?.occurredAt) return { at: now, offline: false, receivedAt: null, skewS: null };
  const measured = t.sentAt ? now.getTime() - t.sentAt.getTime() : null;
  const correction = measured !== null && Math.abs(measured) >= OFFLINE_RULES.correctSkewMs ? measured : 0;
  const at = new Date(t.occurredAt.getTime() + correction);
  if (at.getTime() > now.getTime() + OFFLINE_RULES.futureSkewMs) {
    throw punchError('PUNCH_IN_FUTURE', 'This punch is dated in the future. Check the date and time on your phone.');
  }
  if (now.getTime() - at.getTime() > OFFLINE_RULES.maxAgeMs) {
    throw punchError('PUNCH_TOO_OLD', 'This punch is more than 3 days old. Ask your supervisor to add the time.');
  }
  const offline = !!t.offline || now.getTime() - at.getTime() > OFFLINE_RULES.lateAfterMs;
  const skewS = correction ? Math.round(correction / 1000) : null;
  // Sent live: the server's clock is the record, as it always was.
  if (!offline) return { at: now, offline: false, receivedAt: null, skewS };
  // Never later than now (a phone a little ahead is still "now").
  return { at: at > now ? now : at, offline: true, receivedAt: now, skewS };
}

export interface PunchLocation {
  lat: number;
  lon: number;
  accuracyM: number | null;
}

export async function clockIn(
  tx: Tx,
  input: { tenantId: string; userId: string; facilityId: string; shiftId?: string; positionId?: string; location: PunchLocation | null; ip: string | null; kioskId?: string; timing?: PunchTiming },
) {
  await advisoryLock(tx, `punch:${input.userId}`);
  const clientId = input.timing?.clientId;
  if (clientId) {
    const seen = await tx.timePunch.findFirst({ where: { clientInId: clientId } });
    if (seen) {
      if (seen.userId !== input.userId) throw conflict('PUNCH_ID_TAKEN', 'This punch id is already used.');
      return Object.assign(seen, { duplicate: true });
    }
  }
  const timing = resolveTiming(input.timing);
  const now = timing.at;
  const open = await tx.timePunch.findFirst({ where: { userId: input.userId, clockOut: null } });
  if (open) throw conflict('ALREADY_CLOCKED_IN', 'You are already clocked in.', { punchId: open.id });
  if (timing.offline) {
    // A late clock-in can't land inside time already punched.
    const covering = await tx.timePunch.findFirst({ where: { userId: input.userId, clockIn: { lte: now }, clockOut: { gt: now } } });
    if (covering) throw conflict('PUNCH_OVERLAPS', 'You already have a punch covering this time.', { punchId: covering.id });
  }

  const facility = await tx.facility.findUnique({ where: { id: input.facilityId } });
  if (!facility) throw notFound('Facility');

  let positionId = input.positionId;
  let lateBy = 0;
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

  // Who is on duty changed: the deck plan refreshes (lib/changes.ts; sent at commit).
  await announceChange(tx, input.tenantId, 'deck');
  const punch = await tx.timePunch.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      facilityId: input.facilityId,
      shiftId: input.shiftId ?? null,
      positionId,
      clockIn: now,
      // Only whether they were at the facility (and how far off) is kept: never where they were, or their IP.
      ipAddress: null,
      latitude: null,
      longitude: null,
      accuracyM: input.location?.accuracyM ?? null,
      distanceM: loc.distanceM,
      // At a facility's kiosk the tablet is the facility: on site by definition.
      locationStatus: input.kioskId ? 'VERIFIED' : loc.status,
      kioskId: input.kioskId ?? null,
      clientInId: clientId ?? null,
      recordedOffline: timing.offline,
      clockInReceivedAt: timing.receivedAt,
      clockSkewS: timing.skewS,
    },
  });
  if (timing.offline) {
    await audit(tx, {
      tenantId: input.tenantId,
      actorId: input.userId,
      action: 'punch.offline_in',
      entity: 'TimePunch',
      entityId: punch.id,
      after: { clockIn: punch.clockIn, receivedAt: timing.receivedAt, deviceTime: input.timing?.occurredAt, clockSkewS: timing.skewS, locationStatus: punch.locationStatus },
    });
  }

  if (lateBy > LATE_GRACE_MINUTES) {
    await tx.reliabilityEvent.create({
      data: { tenantId: input.tenantId, userId: input.userId, type: 'LATE_PUNCH', occurredAt: now, sourceId: punch.id },
    });
  }
  return Object.assign(punch, { duplicate: false });
}

export async function clockOut(tx: Tx, userId: string, input: PunchTiming = {}) {
  await advisoryLock(tx, `punch:${userId}`);
  if (input.clientId) {
    const seen = await tx.timePunch.findFirst({ where: { clientOutId: input.clientId } });
    if (seen) {
      if (seen.userId !== userId) throw conflict('PUNCH_ID_TAKEN', 'This punch id is already used.');
      return Object.assign(seen, { duplicate: true });
    }
  }
  const timing = resolveTiming(input);
  const open = await tx.timePunch.findFirst({ where: { userId, clockOut: null } });
  if (!open) throw conflict('NOT_CLOCKED_IN', 'You are not clocked in.');
  const at = timing.at;
  if (at <= open.clockIn) throw punchError('PUNCH_OUT_BEFORE_IN', 'This clock-out is before the clock-in. Ask your supervisor to fix the time.');
  // Nothing else may start inside this punch (a late clock-in sent after a later punch, e.g. at the kiosk).
  const inside = await tx.timePunch.findFirst({ where: { userId, id: { not: open.id }, clockIn: { gt: open.clockIn, lt: at } } });
  if (inside) throw conflict('PUNCH_OVERLAPS', 'You already have a punch covering this time.', { punchId: inside.id });
  const skews = [open.clockSkewS, timing.skewS].filter((x): x is number => x !== null);
  // Who is on duty changed: the deck plan refreshes (lib/changes.ts; sent at commit).
  await announceChange(tx, open.tenantId, 'deck');
  const updated = await tx.timePunch.update({
    where: { id: open.id },
    data: {
      clockOut: at,
      clientOutId: input.clientId ?? null,
      ...(timing.offline ? { recordedOffline: true, clockOutReceivedAt: timing.receivedAt } : {}),
      ...(skews.length ? { clockSkewS: skews.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m)) } : {}),
    },
  });
  if (timing.offline) {
    await audit(tx, {
      tenantId: open.tenantId,
      actorId: userId,
      action: 'punch.offline_out',
      entity: 'TimePunch',
      entityId: open.id,
      after: { clockOut: at, receivedAt: timing.receivedAt, deviceTime: input.occurredAt, clockSkewS: timing.skewS },
    });
  }
  return Object.assign(updated, { duplicate: false });
}

/** Supervisor correction. The original value is preserved in TimePunchEdit. */
export async function editPunch(
  tx: Tx,
  input: { tenantId: string; actorId: string; punchId: string; clockIn?: Date; clockOut?: Date; reason: string; inScope?: (userId: string) => Promise<boolean> },
) {
  if (!input.reason.trim()) throw badRequest('A reason is required to edit a punch.');
  const punch = await tx.timePunch.findUnique({ where: { id: input.punchId } });
  if (!punch) throw notFound('Punch');
  // Nobody corrects their own time, or time outside their department.
  if (punch.userId === input.actorId) throw forbidden('You can’t edit your own punches. Ask another supervisor.');
  if (input.inScope && !(await input.inScope(punch.userId))) throw forbidden('This person isn’t in your department.');
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
  const changed = (input.clockIn && input.clockIn.getTime() !== punch.clockIn.getTime()) || (input.clockOut && input.clockOut.getTime() !== punch.clockOut?.getTime());
  // A changed approved punch goes back for approval (by someone other than the editor), so it can't be padded after the fact.
  const updated = await tx.timePunch.update({ where: { id: punch.id }, data: { ...next, varianceReason: input.reason, ...(changed && punch.status === 'APPROVED' ? { status: 'PENDING' } : {}) } });
  await audit(tx, { tenantId: input.tenantId, actorId: input.actorId, action: 'punch.edit', entity: 'TimePunch', entityId: punch.id, before: punch, after: updated });
  return updated;
}
