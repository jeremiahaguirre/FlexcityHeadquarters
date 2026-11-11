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
import type { TimeOffType } from '@prisma/client';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { lieuAvailable, lieuPolicy } from '../payroll/lieu.js';
import { readSettings } from '../payroll/payRuns.js';
import type { DomainEvent } from '../../lib/events.js';
import { addDays } from '../../lib/time.js';
import { approversFor } from './reporting.js';
import { postOffer } from '../shiftboard/offers.js';
import { leaveHoursFrom, scheduledShifts } from './leaveHours.js';

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
    const want = leaveHoursFrom({ startsAt: input.startsAt, endsAt: input.endsAt }, await scheduledShifts(tx, [userId], input.startsAt, input.endsAt)).hours;
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

export async function cancelTimeOff(tx: Tx, userId: string, id: string) {
  const r = await tx.timeOffRequest.findUnique({ where: { id } });
  if (!r || r.userId !== userId) throw notFound('Time-off request');
  if (r.status === 'CANCELLED' || r.status === 'DENIED') throw conflict('NOT_ACTIVE', 'This request is already closed.');
  if (r.status === 'APPROVED' && r.startsAt <= new Date()) throw conflict('ALREADY_STARTED', 'Time off that has started can only be changed by a supervisor.');
  return tx.timeOffRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
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
  const charged = status === 'APPROVED' ? leaveHoursFrom(r, await scheduledShifts(tx, [r.userId], r.startsAt, r.endsAt)) : null;
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
    }
  }
  events.push({
    type: 'notify',
    tenantId: actor.tenantId,
    drafts: [{ userId: r.userId, type: 'time_off_decided', params: { requestId: id, status, note: note ?? null }, link: '/time-off', email: 'time_off_decided' }],
  });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: `timeoff.${decision.toLowerCase()}`, entity: 'TimeOffRequest', entityId: id, after: { note, reopenedShifts: reopened, ...(charged ? { leaveHours: charged.hours, basis: charged.basis } : {}) } });
  return { status, reopenedShifts: reopened, events };
}
