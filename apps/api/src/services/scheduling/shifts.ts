/**
 * Shift lifecycle: create (draft), edit, assign, cancel, publish.
 * Every assignment runs through evaluateCandidate(); hard rules block, overtime
 * needs an explicit acknowledgement from the person assigning.
 */
import type { Prisma, ShiftType } from '@prisma/client';
import { chargeOvertime, fairnessCheck } from './overtime.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { DomainEvent } from '../../lib/events.js';
import { dec } from '../../lib/money.js';
import { type Evaluation, evaluateCandidate } from './eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { postOffer } from '../shiftboard/offers.js';
import type { NotificationDraft } from '../notifications/notifier.js';

export interface Actor {
  userId: string;
  tenantId: string;
}

const MAX_SHIFT_HOURS = 16;

function validateTimes(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw badRequest('A shift must end after it starts.');
  if (endsAt.getTime() - startsAt.getTime() > MAX_SHIFT_HOURS * 3_600_000) throw badRequest(`A shift can be at most ${MAX_SHIFT_HOURS} hours.`);
}

export interface ShiftInput {
  facilityId: string;
  positionId: string;
  startsAt: Date;
  endsAt: Date;
  shiftType?: ShiftType;
  customTitle?: string | null;
  premiumPerHour?: string | null;
}

export async function createShift(tx: Tx, actor: Actor, input: ShiftInput) {
  validateTimes(input.startsAt, input.endsAt);
  const [facility, position] = await Promise.all([
    tx.facility.findUnique({ where: { id: input.facilityId } }),
    tx.position.findUnique({ where: { id: input.positionId } }),
  ]);
  if (!facility) throw notFound('Facility');
  if (!position) throw notFound('Position');
  if (input.shiftType === 'CUSTOM' && !input.customTitle?.trim()) throw badRequest('Custom shifts need a title.');
  const shift = await tx.shift.create({
    data: {
      tenantId: actor.tenantId,
      facilityId: input.facilityId,
      positionId: input.positionId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      shiftType: input.shiftType ?? 'STANDARD',
      customTitle: input.customTitle ?? null,
      premiumPerHour: input.premiumPerHour ?? null,
    },
  });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.create', entity: 'Shift', entityId: shift.id, after: shift });
  return shift;
}

export async function updateShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  expectedVersion: number,
  patch: Partial<ShiftInput>,
) {
  const before = await tx.shift.findUnique({ where: { id: shiftId } });
  if (!before) throw notFound('Shift');
  // Moving to another facility (the schedule builder's drag between rows); the route checks scope.
  if (patch.facilityId && patch.facilityId !== before.facilityId && !(await tx.facility.findUnique({ where: { id: patch.facilityId } }))) throw notFound('Facility');
  if (before.status === 'CANCELLED') throw conflict('SHIFT_CANCELLED', 'This shift was cancelled.');
  const startsAt = patch.startsAt ?? before.startsAt;
  const endsAt = patch.endsAt ?? before.endsAt;
  validateTimes(startsAt, endsAt);

  const res = await tx.shift.updateMany({
    where: { id: shiftId, version: expectedVersion },
    data: {
      startsAt,
      endsAt,
      facilityId: patch.facilityId ?? before.facilityId,
      positionId: patch.positionId ?? before.positionId,
      shiftType: patch.shiftType ?? before.shiftType,
      customTitle: patch.customTitle === undefined ? before.customTitle : patch.customTitle,
      premiumPerHour: patch.premiumPerHour === undefined ? before.premiumPerHour : patch.premiumPerHour,
      version: { increment: 1 },
    },
  });
  if (res.count !== 1) throw conflict('SHIFT_CHANGED', 'Someone else changed this shift. Refresh and try again.');

  // If someone is assigned, the new times/position must still be legal for them.
  if (before.userId) {
    const bundle = (await loadShiftBundle(tx, shiftId))!;
    const c = await loadCandidate(tx, bundle, before.userId);
    const e = c && evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
    if (e && !e.eligible) {
      throw new HttpError(422, 'ASSIGNEE_NOT_ELIGIBLE', 'The assigned person could not work this shift after the change. Unassign them first.', { blocks: e.blocks });
    }
  }
  const after = await tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.update', entity: 'Shift', entityId: shiftId, before, after });
  const events: DomainEvent[] =
    before.userId && after.status === 'PUBLISHED' && (before.startsAt.getTime() !== after.startsAt.getTime() || before.endsAt.getTime() !== after.endsAt.getTime())
      ? [{ type: 'notify', tenantId: actor.tenantId, drafts: [{ userId: before.userId, type: 'shift_changed', params: { shiftId }, link: '/schedule' }] }]
      : [];
  return { shift: after, events };
}

export interface AssignResult {
  shift: Prisma.ShiftGetPayload<object>;
  evaluation: Evaluation | null;
  events: DomainEvent[];
}

/**
 * Assign (or unassign with userId = null). Hard rules always block. Overtime
 * requires acknowledgeOvertime = true, recorded in the audit log.
 */
export async function assignShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  userId: string | null,
  expectedVersion: number,
  acknowledgeOvertime = false,
): Promise<AssignResult> {
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) throw notFound('Shift');
  if (bundle.shift.status === 'CANCELLED') throw conflict('SHIFT_CANCELLED', 'This shift was cancelled.');
  if (bundle.shift.version !== expectedVersion) throw conflict('SHIFT_CHANGED', 'Someone else changed this shift. Refresh and try again.');
  const previous = bundle.shift.userId;

  let evaluation: Evaluation | null = null;
  if (userId) {
    const c = await loadCandidate(tx, bundle, userId);
    if (!c) throw notFound('Staff member');
    evaluation = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
    if (!evaluation.eligible) throw new HttpError(422, 'NOT_ELIGIBLE', 'This person cannot work this shift.', { blocks: evaluation.blocks });
    if (evaluation.overtimeHours.gt(0) && !acknowledgeOvertime) {
      // Say who would be skipped under the overtime-equalization order, if anyone.
      const fairness = await fairnessCheck(tx, shiftId, userId);
      throw conflict('OVERTIME_REQUIRES_ACK', `This adds ${evaluation.overtimeHours.toFixed(2)} h of overtime. Confirm to assign anyway.`, {
        overtimeHours: evaluation.overtimeHours.toFixed(2),
        skipped: fairness?.skipped ?? [],
        clause: fairness?.clause ?? null,
      });
    }
  }

  const res = await tx.shift.updateMany({
    where: { id: shiftId, version: expectedVersion },
    data: { userId, version: { increment: 1 }, conflictReason: null },
  });
  if (res.count !== 1) throw conflict('SHIFT_CHANGED', 'Someone else changed this shift. Refresh and try again.');
  // Any open board offer is superseded by a direct assignment.
  await tx.shiftOffer.updateMany({ where: { shiftId, status: { in: ['OPEN', 'PENDING_APPROVAL'] } }, data: { status: 'CANCELLED' } });

  await audit(tx, {
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: userId ? 'shift.assign' : 'shift.unassign',
    entity: 'Shift',
    entityId: shiftId,
    before: { userId: previous },
    after: { userId, overtimeAcknowledged: acknowledgeOvertime && !!evaluation?.overtimeHours.gt(0), overtimeHours: evaluation?.overtimeHours.toString() },
  });

  if (userId && evaluation?.overtimeHours.gt(0)) await chargeOvertime(tx, actor.tenantId, actor.userId, userId, shiftId, evaluation.overtimeHours.toFixed(2), bundle.shift.positionId);
  const shift = await tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
  const drafts: NotificationDraft[] = [];
  if (shift.status === 'PUBLISHED') {
    if (userId) drafts.push({ userId, type: 'shift_assigned', params: { shiftId }, link: '/schedule', email: 'shift_assigned' });
    if (previous && previous !== userId) drafts.push({ userId: previous, type: 'shift_unassigned', params: { shiftId }, link: '/schedule' });
  }
  return { shift, evaluation, events: drafts.length ? [{ type: 'notify', tenantId: actor.tenantId, drafts }] : [] };
}

export async function cancelShift(tx: Tx, actor: Actor, shiftId: string, reason: string) {
  const shift = await tx.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw notFound('Shift');
  if (shift.status === 'CANCELLED') return { events: [] as DomainEvent[] };
  await tx.shift.update({ where: { id: shiftId }, data: { status: 'CANCELLED', version: { increment: 1 }, conflictReason: reason } });
  await tx.shiftOffer.updateMany({ where: { shiftId, status: { in: ['OPEN', 'PENDING_APPROVAL'] } }, data: { status: 'CANCELLED' } });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.cancel', entity: 'Shift', entityId: shiftId, after: { reason } });
  const events: DomainEvent[] =
    shift.userId && shift.status === 'PUBLISHED'
      ? [{ type: 'notify', tenantId: actor.tenantId, drafts: [{ userId: shift.userId, type: 'shift_cancelled', params: { shiftId, reason }, link: '/schedule' }] }]
      : [];
  return { events };
}

/**
 * Publish drafts in a window. Assigned people are told once each; unassigned
 * shifts go straight onto the Shift Board for eligible staff.
 */
/** `only`: a department supervisor publishes their own department's drafts, nobody else's. */
export async function publishShifts(tx: Tx, actor: Actor, facilityId: string, from: Date, to: Date, only: Prisma.ShiftWhereInput = {}) {
  const drafts = await tx.shift.findMany({ where: { ...only, facilityId, status: 'DRAFT', startsAt: { gte: from, lt: to } } });
  if (drafts.length === 0) return { published: 0, posted: 0, events: [] as DomainEvent[] };
  await tx.shift.updateMany({ where: { id: { in: drafts.map((d) => d.id) } }, data: { status: 'PUBLISHED', version: { increment: 1 } } });

  const counts = new Map<string, number>();
  for (const d of drafts) if (d.userId) counts.set(d.userId, (counts.get(d.userId) ?? 0) + 1);
  const events: DomainEvent[] = [];
  if (counts.size) {
    events.push({
      type: 'notify',
      tenantId: actor.tenantId,
      drafts: [...counts].map(([userId, count]) => ({ userId, type: 'schedule_published', params: { count }, link: '/schedule' })),
    });
  }
  let posted = 0;
  for (const d of drafts.filter((x) => !x.userId && x.startsAt > new Date())) {
    const r = await postOffer(tx, { userId: actor.userId, tenantId: actor.tenantId, canPostOpenShifts: true }, d.id);
    events.push(...r.events);
    posted++;
  }
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.publish', entity: 'Facility', entityId: facilityId, after: { count: drafts.length, from, to } });
  return { published: drafts.length, posted, events };
}

/** Everyone qualified for a shift, ranked: eligible without overtime, then with, then blocked. */
export async function rankCandidates(tx: Tx, shiftId: string) {
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) throw notFound('Shift');
  const qualified = await tx.user.findMany({
    where: { status: 'ACTIVE', anonymizedAt: null, positions: { some: { positionId: bundle.shift.positionId } }, id: bundle.shift.userId ? { not: bundle.shift.userId } : undefined },
    select: { id: true, firstName: true, lastName: true, employmentStatus: true },
  });
  const out: Array<{
    user: (typeof qualified)[number];
    eligible: boolean;
    overtimeHours: string;
    weeklyHoursAfter: string;
    blocks: Evaluation['blocks'];
    flags: Evaluation['flags'];
  }> = [];
  for (const u of qualified) {
    const c = await loadCandidate(tx, bundle, u.id);
    if (!c) continue;
    const e = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
    out.push({
      user: u,
      eligible: e.eligible,
      overtimeHours: e.overtimeHours.toFixed(2),
      weeklyHoursAfter: e.weeklyHoursAfter.toFixed(2),
      blocks: e.blocks,
      flags: e.flags,
    });
  }
  const rank = (x: (typeof out)[number]) => (x.eligible ? (dec(x.overtimeHours).gt(0) ? 1 : 0) : 2);
  out.sort((a, b) => rank(a) - rank(b) || Number(a.weeklyHoursAfter) - Number(b.weeklyHoursAfter));
  return { shiftVersion: bundle.shift.version, candidates: out };
}
