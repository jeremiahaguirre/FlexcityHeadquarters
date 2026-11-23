/**
 * Availability and time off.
 *
 * - Availability is replaced as a whole set from an effective date, so history
 *   (what someone was available for last month) is never rewritten.
 * - Approving time off frees the person's overlapping published shifts and
 *   posts them to the Shift Board, so coverage starts immediately.
 * - Statutory sick days and protected leave usually cannot lawfully be refused;
 *   declining one requires a written reason, which is audited.
 */
import type { TimeOffType } from '../../generated/prisma/client.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { lieuAvailable, lieuPolicy } from '../payroll/lieu.js';
import { readSettings } from '../payroll/payRuns.js';
import type { DomainEvent } from '../../lib/events.js';
import { addDays, localDate } from '../../lib/time.js';
import { approversFor } from './reporting.js';
import { postOffer } from '../shiftboard/offers.js';
import { leaveHoursFrom, personLeaveTimeZone, scheduledShifts } from './leaveHours.js';

export interface AvailabilityWindow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export function validateWindows(windows: AvailabilityWindow[]): void {
  for (const w of windows) {
    if (!Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6) throw badRequest('Day of week must be 0 (Sunday) to 6.');
    if (w.startMinute < 0 || w.endMinute > 1440 || w.endMinute <= w.startMinute) throw badRequest('Each window must start before it ends, within the day.');
  }
  for (let d = 0; d < 7; d++) {
    const day = windows.filter((w) => w.dayOfWeek === d).sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < day.length; i++) {
      if (day[i]!.startMinute < day[i - 1]!.endMinute) throw badRequest('Availability windows on the same day must not overlap.');
    }
  }
}

export async function replaceAvailability(tx: Tx, tenantId: string, userId: string, effectiveFrom: string, windows: AvailabilityWindow[]) {
  validateWindows(windows);
  const from = new Date(`${effectiveFrom}T00:00:00Z`);
  // Windows that hadn't started yet are simply replaced; current ones end the day before.
  await tx.availability.deleteMany({ where: { userId, effectiveFrom: { gte: from } } });
  await tx.availability.updateMany({
    where: { userId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
    data: { effectiveTo: new Date(`${addDays(effectiveFrom, -1)}T00:00:00Z`) },
  });
  if (windows.length) {
    await tx.availability.createMany({ data: windows.map((w) => ({ tenantId, userId, ...w, effectiveFrom: from })) });
  }
  return tx.availability.findMany({ where: { userId, effectiveFrom: from }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
}

const PROTECTED: ReadonlySet<TimeOffType> = new Set(['SICK', 'PROTECTED_LEAVE']);

export async function requestTimeOff(
  tx: Tx,
  tenantId: string,
  userId: string,
  input: { type: TimeOffType; startsAt: Date; endsAt: Date; note?: string | null },
) {
  if (input.endsAt <= input.startsAt) throw badRequest('Time off must end after it starts.');
  if (input.endsAt.getTime() - input.startsAt.getTime() > 120 * 86_400_000) throw badRequest('Requests longer than 120 days go through HR.');
  const overlapping = await tx.timeOffRequest.findFirst({
    where: { userId, status: { in: ['PENDING', 'APPROVED'] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
  });
  if (overlapping) throw conflict('TIME_OFF_OVERLAPS', 'You already have time off requested for part of this period.');
  if (input.type === 'LIEU') {
    const policy = lieuPolicy(readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings));
    if (!policy.enabled) throw badRequest('Your organization doesn’t use time in lieu.');
    const want = leaveHoursFrom({ startsAt: input.startsAt, endsAt: input.endsAt }, await scheduledShifts(tx, [userId], input.startsAt, input.endsAt), await personLeaveTimeZone(tx, userId, input.startsAt)).hours;
    const have = await lieuAvailable(tx, userId);
    if (want > have + 0.001) throw new HttpError(400, 'LIEU_SHORT', `This needs ${want} hours of banked time; you have ${Math.max(0, have)}.`, { need: want, have: Math.max(0, have) });
  }

  const req = await tx.timeOffRequest.create({ data: { tenantId, userId, ...input, note: input.note ?? null } });
  const affected = await tx.shift.findMany({
    where: { userId, status: 'PUBLISHED', startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
    select: { id: true },
  });
  // Their manager first; then their department's managers; then everyone who approves time off.
  const approvers = (await approversFor(tx, tenantId, [userId], 'timeoff.approve')).to;
  const events: DomainEvent[] = [
    {
      type: 'notify',
      tenantId,
      drafts: approvers.map((id) => ({ userId: id, type: 'time_off_requested', params: { requestId: req.id, kind: input.type, shifts: affected.length }, link: '/manage/approvals' })),
    },
  ];
  return { request: req, affectedShifts: affected.length, events };
}

/**
 * Shifts approving this leave took the person off (and posted to the board), from `from` on:
 * the ones still open on the board go back to them; the ones a coworker took (or claimed, waiting
 * for approval) stay where they are.
 */
async function giveBackShifts(tx: Tx, r: { userId: string; releasedShiftIds: string[] }, from: Date) {
  const since = new Date(Math.max(from.getTime(), Date.now()));
  const restored: string[] = [];
  const taken: string[] = [];
  for (const shiftId of r.releasedShiftIds) {
    const s = await tx.shift.findUnique({ where: { id: shiftId }, select: { id: true, userId: true, status: true, startsAt: true } });
    if (!s || s.status === 'CANCELLED' || s.startsAt < since) continue;
    if (s.userId !== null || (await tx.shiftOffer.count({ where: { shiftId, status: 'PENDING_APPROVAL' } }))) {
      if (s.userId !== r.userId) taken.push(shiftId);
      continue;
    }
    await tx.shiftOffer.updateMany({ where: { shiftId, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    await tx.shift.update({ where: { id: shiftId }, data: { userId: r.userId, version: { increment: 1 }, conflictReason: null } });
    restored.push(shiftId);
  }
  return { restored, taken };
}

/** Who hears that approved leave changed: whoever approved it, and the people who approve this person's time off. */
async function leaveWatchers(tx: Tx, tenantId: string, r: { userId: string; decidedById: string | null }, exclude: string[]) {
  const to = new Set((await approversFor(tx, tenantId, [r.userId], 'timeoff.approve', exclude)).to);
  if (r.decidedById && !exclude.includes(r.decidedById) && r.decidedById !== r.userId) to.add(r.decidedById);
  return [...to];
}

/**
 * The person cancels their own request. Approved leave that hasn't started: the shifts it released
 * that are still open on the board come back to them, and the approvers are told what changed
 * (and which shifts a coworker has already taken).
 */
export async function cancelTimeOff(tx: Tx, userId: string, id: string) {
  const r = await tx.timeOffRequest.findUnique({ where: { id } });
  if (!r || r.userId !== userId) throw notFound('Time-off request');
  if (r.status === 'CANCELLED' || r.status === 'DENIED') throw conflict('NOT_ACTIVE', 'This request is already closed.');
  if (r.status === 'APPROVED' && r.startsAt <= new Date()) throw conflict('ALREADY_STARTED', 'Time off that has started can only be changed by a supervisor.');
  const request = await tx.timeOffRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  const events: DomainEvent[] = [];
  let shifts = { restored: [] as string[], taken: [] as string[] };
  if (r.status === 'APPROVED') {
    shifts = await giveBackShifts(tx, r, r.startsAt);
    const to = await leaveWatchers(tx, r.tenantId, r, [userId]);
    const who = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true } });
    events.push({
      type: 'notify',
      tenantId: r.tenantId,
      drafts: to.map((u) => ({ userId: u, type: 'time_off_cancelled', params: { requestId: id, kind: r.type, name: `${who.firstName} ${who.lastName}`, restored: shifts.restored.length, taken: shifts.taken.length }, link: '/manage/approvals' })),
    });
    await audit(tx, { tenantId: r.tenantId, actorId: userId, action: 'timeoff.cancel', entity: 'TimeOffRequest', entityId: id, before: { status: r.status }, after: { restoredShifts: shifts.restored, takenShifts: shifts.taken } });
  }
  return { request, restoredShifts: shifts.restored.length, takenShifts: shifts.taken.length, events };
}

/**
 * Leave from `from` to `to` overlaps a regular pay run that was approved or paid (city-wide, or for
 * one of the person's departments): its leave and banked-time hours are on a pay statement, so it
 * can't be changed or added after the fact. A correction is a one-time item on the next run.
 */
export async function assertLeavePeriodOpen(tx: Tx, userId: string, from: Date, to: Date) {
  if (to <= from) return;
  const tz = await personLeaveTimeZone(tx, userId, from);
  const first = new Date(`${localDate(from, tz)}T00:00:00Z`);
  const last = new Date(`${localDate(new Date(to.getTime() - 1), tz)}T00:00:00Z`);
  const departments = (await tx.userPosition.findMany({ where: { userId }, select: { position: { select: { departmentId: true } } } })).map((p) => p.position.departmentId).filter((d): d is string => !!d);
  const run = await tx.payRun.findFirst({
    where: { kind: 'REGULAR', status: { in: ['APPROVED', 'PAID'] }, periodStart: { lte: last }, periodEnd: { gte: first }, OR: [{ departmentId: null }, ...(departments.length ? [{ departmentId: { in: departments } }] : [])] },
    select: { id: true },
  });
  if (run) throw conflict('PERIOD_PAID', 'Part of this time off is in a pay period that was already approved or paid. Correct it with a one-time item on the next pay run.', { payRunId: run.id });
}

/**
 * A supervisor or HR changes approved leave: ends it early (back a week early) or cancels it
 * (approved by mistake, or reversed). A reason is required; it is audited and the person is told.
 * Shifts the leave released after the new end that nobody has taken go back to the person, and
 * the leave hours charged are measured again for what is left.
 */
export async function reviseTimeOff(
  tx: Tx,
  actor: { userId: string; tenantId: string },
  id: string,
  change: { action: 'END_EARLY' | 'CANCEL'; endsAt?: Date; reason: string },
) {
  const r = await tx.timeOffRequest.findUnique({ where: { id } });
  if (!r) throw notFound('Time-off request');
  if (r.userId === actor.userId) throw new HttpError(403, 'OWN_REQUEST', 'You can’t change your own time off. Another supervisor has to.');
  if (r.status !== 'APPROVED') throw conflict('LEAVE_NOT_APPROVED', 'Only approved time off can be changed this way.');
  const reason = change.reason.trim();
  if (reason.length < 3) throw invalid('REASON_REQUIRED', 'Say why the time off is changing; the person will see it.');
  let endsAt = r.endsAt;
  if (change.action === 'END_EARLY') {
    if (!change.endsAt) throw invalid('END_REQUIRED', 'Choose the new last day.');
    if (change.endsAt <= r.startsAt || change.endsAt >= r.endsAt) throw new HttpError(400, 'BAD_END', 'The new end must be after the start and before the current end.');
    endsAt = change.endsAt;
  }
  const from = change.action === 'CANCEL' ? r.startsAt : endsAt;
  // The part that goes away must not be in a pay period already paid.
  await assertLeavePeriodOpen(tx, r.userId, from, r.endsAt);
  const shifts = await giveBackShifts(tx, r, from);
  // Leave hours for what is left: the shifts it still covers (released ones included), as at approval.
  let kept: ReturnType<typeof leaveHoursFrom> | null = null;
  if (change.action === 'END_EARLY') {
    const covered = await tx.shift.findMany({
      where: { status: { not: 'CANCELLED' }, startsAt: { lt: endsAt }, endsAt: { gt: r.startsAt }, OR: [{ id: { in: r.releasedShiftIds } }, { userId: r.userId }] },
      select: { startsAt: true, endsAt: true },
    });
    kept = leaveHoursFrom({ startsAt: r.startsAt, endsAt }, covered, await personLeaveTimeZone(tx, r.userId, r.startsAt));
  }
  await tx.timeOffRequest.update({
    where: { id },
    data: change.action === 'CANCEL' ? { status: 'CANCELLED', decisionNote: reason } : { endsAt, decisionNote: reason, ...(r.chargedHours != null && kept ? { chargedHours: kept.hours, chargedBasis: kept.basis } : {}) },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: change.action === 'CANCEL' ? 'timeoff.revoke' : 'timeoff.end_early',
    entity: 'TimeOffRequest',
    entityId: id,
    before: { status: r.status, endsAt: r.endsAt, chargedHours: r.chargedHours },
    after: { reason, endsAt, restoredShifts: shifts.restored, takenShifts: shifts.taken, ...(kept ? { chargedHours: kept.hours } : {}) },
  });
  const events: DomainEvent[] = [
    {
      type: 'notify',
      tenantId: actor.tenantId,
      drafts: [{ userId: r.userId, type: change.action === 'CANCEL' ? 'time_off_revoked' : 'time_off_shortened', params: { requestId: id, action: change.action, reason, restored: shifts.restored.length }, link: '/time-off' }],
    },
  ];
  return { status: change.action === 'CANCEL' ? 'CANCELLED' : 'APPROVED', endsAt, restoredShifts: shifts.restored.length, takenShifts: shifts.taken.length, events };
}

export async function decideTimeOff(
  tx: Tx,
  actor: { userId: string; tenantId: string },
  id: string,
  decision: 'APPROVE' | 'DENY',
  note?: string | null,
) {
  const r = await tx.timeOffRequest.findUnique({ where: { id } });
  if (!r) throw notFound('Time-off request');
  if (r.userId === actor.userId) throw forbidden('You cannot decide your own request.');
  if (r.status !== 'PENDING') throw conflict('NOT_PENDING', 'This request has already been decided.');
  if (decision === 'DENY' && PROTECTED.has(r.type) && !note?.trim()) {
    throw badRequest('Statutory sick days and protected leave usually cannot be refused. Record the reason to decline.');
  }

  const status = decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
  // Measured now, from the shifts it takes them off, before those shifts are released below.
  const charged = status === 'APPROVED' ? leaveHoursFrom(r, await scheduledShifts(tx, [r.userId], r.startsAt, r.endsAt), await personLeaveTimeZone(tx, r.userId, r.startsAt)) : null;
  if (charged && r.type === 'LIEU') {
    const have = await lieuAvailable(tx, r.userId, r.id);
    if (charged.hours > have + 0.001) throw new HttpError(409, 'LIEU_SHORT', `This needs ${charged.hours} hours of banked time; they have ${Math.max(0, have)}.`, { need: charged.hours, have: Math.max(0, have) });
  }
  await tx.timeOffRequest.update({
    where: { id },
    data: { status, decisionNote: note ?? null, decidedById: actor.userId, decidedAt: new Date(), ...(charged ? { chargedHours: charged.hours, chargedBasis: charged.basis } : {}) },
  });

  const events: DomainEvent[] = [];
  let reopened = 0;
  const released: string[] = [];
  if (status === 'APPROVED') {
    const shifts = await tx.shift.findMany({
      where: { userId: r.userId, status: { in: ['PUBLISHED', 'DRAFT'] }, startsAt: { lt: r.endsAt, gt: new Date() }, endsAt: { gt: r.startsAt } },
    });
    for (const s of shifts) {
      await tx.shift.update({ where: { id: s.id }, data: { userId: null, version: { increment: 1 }, conflictReason: 'Assigned person is on approved time off' } });
      await tx.shiftOffer.updateMany({ where: { shiftId: s.id, status: { in: ['OPEN', 'PENDING_APPROVAL'] } }, data: { status: 'CANCELLED' } });
      if (s.status === 'PUBLISHED') {
        const posted = await postOffer(tx, { userId: actor.userId, tenantId: actor.tenantId, canPostOpenShifts: true }, s.id);
        events.push(...posted.events);
      }
      reopened++;
      released.push(s.id);
    }
    if (released.length) await tx.timeOffRequest.update({ where: { id }, data: { releasedShiftIds: released } });
  }
  events.push({
    type: 'notify',
    tenantId: actor.tenantId,
    drafts: [{ userId: r.userId, type: 'time_off_decided', params: { requestId: id, status, note: note ?? null }, link: '/time-off', email: 'time_off_decided' }],
  });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: `timeoff.${decision.toLowerCase()}`, entity: 'TimeOffRequest', entityId: id, after: { note, reopenedShifts: reopened, ...(charged ? { leaveHours: charged.hours, basis: charged.basis } : {}) } });
  return { status, reopenedShifts: reopened, events };
}
