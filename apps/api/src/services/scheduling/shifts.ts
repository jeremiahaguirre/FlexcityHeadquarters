/**
 * Shift lifecycle: create (draft), edit, assign, cancel, publish.
 * Every assignment runs through evaluateCandidate(); hard rules block, overtime
 * needs an explicit acknowledgement from the person assigning.
 */
import type { Prisma, ShiftType } from '../../generated/prisma/client.js';
import { chargeOvertime, fairnessCheck, reverseOvertime } from './overtime.js';
import { lockForAssignment } from './locks.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { DomainEvent } from '../../lib/events.js';
import { dec } from '../../lib/money.js';
import { type Evaluation, evaluateCandidate } from './eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { postOffer } from '../shiftboard/offers.js';
import type { NotificationDraft } from '../notifications/notifier.js';
import { coverageGaps } from '../coverage/gaps.js';
import { addDays, localDate } from '../../lib/time.js';
import { FEDERAL_SCHEDULE_NOTICE_HOURS } from '../compliance/provincialRules.js';
import { recordShiftChange } from './changeNotice.js';
import { effectiveWorkRules, parseWorkRules } from './workRules.js';
import { type ShiftWarning, shiftWarnings, warningShiftInclude } from './shiftWarnings.js';

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
  /** Unpaid meal break minutes; null = the position's. */
  unpaidBreakMinutes?: number | null;
  /** Never alone; null = the position's flag. */
  neverAlone?: boolean | null;
  callBack?: boolean;
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
      unpaidBreakMinutes: input.unpaidBreakMinutes ?? null,
      neverAlone: input.neverAlone ?? null,
      callBack: input.callBack ?? false,
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
      unpaidBreakMinutes: patch.unpaidBreakMinutes === undefined ? before.unpaidBreakMinutes : patch.unpaidBreakMinutes,
      neverAlone: patch.neverAlone === undefined ? before.neverAlone : patch.neverAlone,
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
  // A published shift's new times: the notice it gave, and a premium when it was late.
  const late = await recordShiftChange(tx, actor, before, after);
  const events: DomainEvent[] =
    before.userId && after.status === 'PUBLISHED' && (before.startsAt.getTime() !== after.startsAt.getTime() || before.endsAt.getTime() !== after.endsAt.getTime())
      ? [{ type: 'notify', tenantId: actor.tenantId, drafts: [{ userId: before.userId, type: 'shift_changed', params: { shiftId }, link: '/schedule' }, ...late] }]
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
  const head = await tx.shift.findUnique({ where: { id: shiftId } });
  if (!head) throw notFound('Shift');
  // One check-and-write per person at a time: no two writers can both book the same person.
  await lockForAssignment(tx, { shiftIds: [shiftId], userIds: [userId, head.userId] });
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

  if (previous && previous !== userId) await reverseOvertime(tx, actor.tenantId, actor.userId, previous, shiftId, userId ? 'Reassigned' : 'Unassigned');
  if (userId && evaluation?.overtimeHours.gt(0)) await chargeOvertime(tx, actor.tenantId, actor.userId, userId, shiftId, evaluation.overtimeHours.toFixed(2), bundle.shift.positionId);
  const shift = await tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
  const drafts: NotificationDraft[] = [];
  if (shift.status === 'PUBLISHED') {
    if (userId) drafts.push({ userId, type: 'shift_assigned', params: { shiftId }, link: '/schedule', email: 'shift_assigned' });
    if (previous && previous !== userId) drafts.push({ userId: previous, type: 'shift_unassigned', params: { shiftId }, link: '/schedule' });
    if (previous !== userId) drafts.push(...(await recordShiftChange(tx, actor, { ...head, userId: previous, status: shift.status }, shift)));
  }
  return { shift, evaluation, events: drafts.length ? [{ type: 'notify', tenantId: actor.tenantId, drafts }] : [] };
}

export async function cancelShift(tx: Tx, actor: Actor, shiftId: string, reason: string) {
  const shift = await tx.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw notFound('Shift');
  if (shift.status === 'CANCELLED') return { events: [] as DomainEvent[] };
  await tx.shift.update({ where: { id: shiftId }, data: { status: 'CANCELLED', version: { increment: 1 }, conflictReason: reason } });
  const late = await recordShiftChange(tx, actor, shift, { ...shift, status: 'CANCELLED' });
  if (shift.userId) await reverseOvertime(tx, actor.tenantId, actor.userId, shift.userId, shiftId, 'Shift cancelled');
  await tx.shiftOffer.updateMany({ where: { shiftId, status: { in: ['OPEN', 'PENDING_APPROVAL'] } }, data: { status: 'CANCELLED' } });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.cancel', entity: 'Shift', entityId: shiftId, after: { reason } });
  const events: DomainEvent[] =
    shift.userId && shift.status === 'PUBLISHED'
      ? [{ type: 'notify', tenantId: actor.tenantId, drafts: [{ userId: shift.userId, type: 'shift_cancelled', params: { shiftId, reason }, link: '/schedule' }, ...late] }]
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

/**
 * Before publishing: the required-coverage gaps the schedule would leave (counting the drafts
 * being published), assigned drafts whose person can no longer work them (a certificate lapsed,
 * onboarding expired…), and, for federally regulated work, shifts inside the 96-hour notice.
 * Warnings only: the person publishing confirms to go ahead (audited).
 */
export async function publishCheck(tx: Tx, facilityId: string, from: Date, to: Date, only: Prisma.ShiftWhereInput = {}) {
  const facility = await tx.facility.findUnique({ where: { id: facilityId }, select: { timezone: true } });
  if (!facility) throw notFound('Facility');
  const tz = facility.timezone;
  const scope: Prisma.ShiftWhereInput = { ...only, facilityId, status: 'DRAFT', startsAt: { gte: from, lt: to } };
  const firstDay = localDate(from, tz);
  const days = Math.max(1, Math.round((Date.parse(`${localDate(new Date(to.getTime() - 1), tz)}T12:00:00Z`) - Date.parse(`${firstDay}T12:00:00Z`)) / 86_400_000) + 1);
  const gaps = await coverageGaps(tx, firstDay, Math.min(days, 62), facilityId, scope);
  const drafts = await tx.shift.findMany({ where: { ...scope, userId: { not: null } }, select: { id: true, userId: true, startsAt: true, user: { select: { firstName: true, lastName: true } } }, orderBy: { startsAt: 'asc' }, take: 500 });
  const ineligible: Array<{ shiftId: string; userId: string; name: string; codes: string[] }> = [];
  let federalLate = 0;
  const now = Date.now();
  for (const d of drafts) {
    const bundle = await loadShiftBundle(tx, d.id);
    if (!bundle) continue;
    if (bundle.rules.province === 'FED' && d.startsAt.getTime() - now < FEDERAL_SCHEDULE_NOTICE_HOURS * 3_600_000) federalLate++;
    const c = await loadCandidate(tx, bundle, d.userId!);
    const e = c && evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
    if (e && !e.eligible) ineligible.push({ shiftId: d.id, userId: d.userId!, name: d.user ? `${d.user.firstName} ${d.user.lastName}` : '', codes: [...new Set(e.blocks.map((b) => b.code))] });
  }
  // Work rules: never-alone shifts left alone, meal breaks missing, shifts under the call-in
  // minimum, and shifts published later than the department's posting notice.
  const all = await tx.shift.findMany({ where: scope, include: { ...warningShiftInclude, user: { select: { firstName: true, lastName: true } } }, orderBy: { startsAt: 'asc' }, take: 2000 });
  const warns = await shiftWarnings(tx, all);
  const listOf = (code: ShiftWarning['code']) => all.filter((x) => warns.get(x.id)?.some((w) => w.code === code)).map((x) => ({ shiftId: x.id, name: x.user ? `${x.user.firstName} ${x.user.lastName}` : '', startsAt: x.startsAt.toISOString(), hours: warns.get(x.id)!.find((w) => w.code === code)!.n[0]! }));
  const tenant = await tx.tenant.findFirstOrThrow({ select: { workRules: true } });
  const wr = parseWorkRules(tenant.workRules);
  let postingLate = 0;
  let postingDays = 0;
  for (const x of all) {
    const days = effectiveWorkRules(wr, x.position.departmentId).notice.postDaysAhead;
    if (days && x.startsAt.getTime() - now < days * 86_400_000) {
      postingLate++;
      postingDays = Math.max(postingDays, days);
    }
  }
  return {
    gaps,
    ineligible,
    federalNotice: federalLate ? { count: federalLate, hours: FEDERAL_SCHEDULE_NOTICE_HOURS } : null,
    twoPerson: listOf('TWO_PERSON'),
    breaks: listOf('BREAK_MISSING').length + listOf('BREAK_SHORT').length,
    shortShifts: listOf('SHORT_SHIFT').length,
    postingNotice: postingLate ? { count: postingLate, days: postingDays } : null,
    through: addDays(firstDay, days - 1),
  };
}

/** Everyone qualified for a shift, ranked: eligible without overtime, then with, then blocked. */
/** `people`: only people the caller may schedule (their scope). */
export async function rankCandidates(tx: Tx, shiftId: string, people: Prisma.UserWhereInput = {}) {
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) throw notFound('Shift');
  const qualified = await tx.user.findMany({
    where: { ...people, status: 'ACTIVE', anonymizedAt: null, positions: { some: { positionId: bundle.shift.positionId } }, id: bundle.shift.userId ? { not: bundle.shift.userId } : undefined },
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
