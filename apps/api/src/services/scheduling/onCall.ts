/**
 * On-call (standby) rosters per department: water/wastewater, public works, snow. Who is on call
 * when, weekly rotations, swaps, and call-backs:
 *  - standby pay and the call-back minimum come from the department's work rules (workRules.ts)
 *    and are paid by payroll (workRulePay.ts);
 *  - a call-back is a published shift marked as one, given to the person on call after the shared
 *    rule check (evaluateCandidate): a rest or overlap problem refuses it unless the supervisor
 *    confirms an emergency (audited), and a short rest before their next shift is flagged to the
 *    department's schedulers;
 *  - winter call-outs ask the person on call first, and working-alone escalations alert them first.
 */
import type { AuthContext } from '../../auth/middleware.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { addDays, localIso } from '../../lib/time.js';
import type { NotificationDraft } from '../notifications/notifier.js';
import { shiftInScope, userInScope } from '../people/scope.js';
import { evaluateCandidate, wallClock } from './eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { NO_DEPARTMENT, schedulableDepartments } from './fillRun.js';
import { lockForAssignment } from './locks.js';
import { createShift } from './shifts.js';

const MAX_PERIOD_MS = 31 * 86_400_000;

async function assertDepartment(tx: Tx, a: AuthContext, departmentId: string) {
  if (departmentId === NO_DEPARTMENT) throw badRequest('Choose a department.');
  const d = (await schedulableDepartments(tx, a)).find((x) => x.id === departmentId);
  if (!d) throw notFound('Department');
  return d;
}

async function assertPerson(tx: Tx, a: AuthContext, positionIds: string[], userId: string) {
  if (!(await userInScope(tx, a.scope, userId))) throw forbidden('This person isn’t in your department.');
  const holds = await tx.userPosition.count({ where: { userId, positionId: { in: positionIds } } });
  if (!holds) throw badRequest('This person doesn’t hold a position in this department.');
}

const nameOf = async (tx: Tx, userId: string) => {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return u ? `${u.firstName} ${u.lastName}` : '';
};

/** Who's on call when, for the departments the caller schedules. */
export async function onCallRoster(tx: Tx, a: AuthContext, q: { departmentId?: string; from: Date; to: Date }) {
  const departments = (await schedulableDepartments(tx, a)).filter((d) => d.id !== NO_DEPARTMENT);
  const ids = q.departmentId ? departments.filter((d) => d.id === q.departmentId).map((d) => d.id) : departments.map((d) => d.id);
  const rows = await tx.onCallPeriod.findMany({ where: { departmentId: { in: ids }, startsAt: { lt: q.to }, endsAt: { gt: q.from } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] });
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, firstName: true, lastName: true, phone: true } });
  const tz = (await tx.facility.findFirst({ select: { timezone: true }, orderBy: { name: 'asc' } }))?.timezone ?? 'America/Toronto';
  const now = new Date();
  return {
    timezone: tz,
    departments: departments.map((d) => ({ id: d.id, name: d.name, nameFr: d.nameFr })),
    periods: rows.map((r) => {
      const u = users.find((x) => x.id === r.userId);
      return { id: r.id, departmentId: r.departmentId, userId: r.userId, name: u ? `${u.firstName} ${u.lastName}` : '', phone: u?.phone ?? null, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), localStartsAt: localIso(r.startsAt, tz), localEndsAt: localIso(r.endsAt, tz), note: r.note, now: r.startsAt <= now && r.endsAt > now };
    }),
  };
}

export interface PeriodInput { departmentId: string; userId: string; startsAt: Date; endsAt: Date; note?: string | null }

async function checkPeriod(tx: Tx, a: AuthContext, p: PeriodInput, exceptId?: string) {
  if (p.endsAt <= p.startsAt) throw badRequest('On call must end after it starts.');
  if (p.endsAt.getTime() - p.startsAt.getTime() > MAX_PERIOD_MS) throw badRequest('An on-call period can be at most 31 days.');
  const d = await assertDepartment(tx, a, p.departmentId);
  await assertPerson(tx, a, d.positionIds, p.userId);
  const clash = await tx.onCallPeriod.findFirst({ where: { departmentId: p.departmentId, userId: p.userId, startsAt: { lt: p.endsAt }, endsAt: { gt: p.startsAt }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw conflict('ONCALL_OVERLAP', 'This person is already on call then.');
  // Approved time off and on call can't overlap.
  const off = await tx.timeOffRequest.count({ where: { userId: p.userId, status: 'APPROVED', startsAt: { lt: p.endsAt }, endsAt: { gt: p.startsAt } } });
  if (off) throw conflict('ONCALL_TIME_OFF', 'This person has approved time off then.');
}

export async function createOnCall(tx: Tx, a: AuthContext, p: PeriodInput) {
  await checkPeriod(tx, a, p);
  const row = await tx.onCallPeriod.create({ data: { tenantId: a.tenantId, departmentId: p.departmentId, userId: p.userId, startsAt: p.startsAt, endsAt: p.endsAt, note: p.note ?? null, createdById: a.userId } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'oncall.create', entity: 'OnCallPeriod', entityId: row.id, after: p });
  const drafts: NotificationDraft[] = [{ userId: p.userId, type: 'oncall_assigned', params: { from: p.startsAt.toISOString(), to: p.endsAt.toISOString() }, link: '/schedule' }];
  return { period: row, drafts };
}

/** A weekly rotation: each person in turn takes a week (or `days`), starting `startDate` at `startHour`. */
export async function rotateOnCall(tx: Tx, a: AuthContext, q: { departmentId: string; userIds: string[]; startDate: string; periods: number; days: number; startHour: number; timezone: string }) {
  if (!q.userIds.length) throw badRequest('Choose who rotates.');
  const out = [];
  const drafts: NotificationDraft[] = [];
  for (let i = 0; i < q.periods; i++) {
    const userId = q.userIds[i % q.userIds.length]!;
    const startsAt = wallClock(addDays(q.startDate, i * q.days), q.startHour * 60, q.timezone);
    const endsAt = wallClock(addDays(q.startDate, (i + 1) * q.days), q.startHour * 60, q.timezone);
    const r = await createOnCall(tx, a, { departmentId: q.departmentId, userId, startsAt, endsAt });
    out.push(r.period);
    drafts.push(...r.drafts);
  }
  return { periods: out, drafts };
}

/** Two people trade on-call periods (or one period changes hands). Both are told. */
export async function swapOnCall(tx: Tx, a: AuthContext, id: string, q: { withId?: string; userId?: string }) {
  const p = await tx.onCallPeriod.findUnique({ where: { id } });
  if (!p) throw notFound('On-call period');
  await assertDepartment(tx, a, p.departmentId);
  const drafts: NotificationDraft[] = [];
  if (q.withId) {
    const o = await tx.onCallPeriod.findUnique({ where: { id: q.withId } });
    if (!o || o.departmentId !== p.departmentId) throw notFound('On-call period');
    if (o.userId === p.userId) throw badRequest('Both periods are the same person’s.');
    // Move both aside first so the overlap check sees the result.
    await tx.onCallPeriod.update({ where: { id: p.id }, data: { userId: o.userId } });
    await tx.onCallPeriod.update({ where: { id: o.id }, data: { userId: p.userId } });
    await checkPeriod(tx, a, { departmentId: p.departmentId, userId: o.userId, startsAt: p.startsAt, endsAt: p.endsAt }, p.id);
    await checkPeriod(tx, a, { departmentId: o.departmentId, userId: p.userId, startsAt: o.startsAt, endsAt: o.endsAt }, o.id);
    await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'oncall.swap', entity: 'OnCallPeriod', entityId: p.id, before: { [p.id]: p.userId, [o.id]: o.userId }, after: { [p.id]: o.userId, [o.id]: p.userId } });
    for (const [u, period] of [[p.userId, o], [o.userId, p]] as const) drafts.push({ userId: u, type: 'oncall_changed', params: { from: period.startsAt.toISOString() }, link: '/schedule' });
    return { drafts };
  }
  if (!q.userId) throw badRequest('Choose who takes it.');
  await checkPeriod(tx, a, { departmentId: p.departmentId, userId: q.userId, startsAt: p.startsAt, endsAt: p.endsAt }, p.id);
  await tx.onCallPeriod.update({ where: { id: p.id }, data: { userId: q.userId } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'oncall.reassign', entity: 'OnCallPeriod', entityId: p.id, before: { userId: p.userId }, after: { userId: q.userId } });
  drafts.push({ userId: p.userId, type: 'oncall_changed', params: { from: p.startsAt.toISOString() }, link: '/schedule' }, { userId: q.userId, type: 'oncall_assigned', params: { from: p.startsAt.toISOString(), to: p.endsAt.toISOString() }, link: '/schedule' });
  return { drafts };
}

export async function deleteOnCall(tx: Tx, a: AuthContext, id: string) {
  const p = await tx.onCallPeriod.findUnique({ where: { id } });
  if (!p) throw notFound('On-call period');
  await assertDepartment(tx, a, p.departmentId);
  await tx.onCallPeriod.delete({ where: { id } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'oncall.delete', entity: 'OnCallPeriod', entityId: id, before: p });
  return { drafts: p.endsAt > new Date() ? [{ userId: p.userId, type: 'oncall_changed', params: { from: p.startsAt.toISOString() }, link: '/schedule' }] as NotificationDraft[] : [] };
}

/** People on call at a moment for the departments of these positions (or the departments given). */
export async function onCallAt(tx: Tx, at: Date, q: { positionIds?: string[]; departmentIds?: string[] }): Promise<string[]> {
  let departmentIds = q.departmentIds ?? [];
  if (q.positionIds?.length) departmentIds = [...departmentIds, ...(await tx.position.findMany({ where: { id: { in: q.positionIds }, departmentId: { not: null } }, select: { departmentId: true } })).map((p) => p.departmentId!)];
  if (!departmentIds.length) return [];
  const rows = await tx.onCallPeriod.findMany({ where: { departmentId: { in: [...new Set(departmentIds)] }, startsAt: { lte: at }, endsAt: { gt: at } }, orderBy: { startsAt: 'asc' }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId))];
}

/** The people on call for the departments a worker belongs to (lone-work escalation). */
export async function onCallForWorker(tx: Tx, workerId: string, at: Date): Promise<string[]> {
  const mine = await tx.userPosition.findMany({ where: { userId: workerId }, select: { positionId: true } });
  return (await onCallAt(tx, at, { positionIds: mine.map((m) => m.positionId) })).filter((u) => u !== workerId);
}

const REST_CODES = new Set(['REST_BETWEEN_SHIFTS', 'DAILY_REST', 'WEEKLY_REST', 'HOS_REST']);

export interface CallBackInput { departmentId: string; userId?: string; facilityId: string; positionId: string; startsAt: Date; endsAt: Date; reason: string; emergency?: boolean }

/**
 * Calls the person on call back in: a published call-back shift (call-back minimum in payroll),
 * after the shared rule check. Rest problems refuse it unless the supervisor confirms an
 * emergency; any other block always refuses. A short rest before the person's next shift is
 * flagged to the schedulers (and returned) so the next shift can be moved.
 */
export async function recordCallBack(tx: Tx, a: AuthContext, input: CallBackInput) {
  const d = await assertDepartment(tx, a, input.departmentId);
  if (!d.positionIds.includes(input.positionId)) throw badRequest('The position isn’t in this department.');
  if (input.endsAt <= input.startsAt) throw badRequest('The call-back must end after it starts.');
  if (!shiftInScope(a.scope, input) || !(await tx.facility.findUnique({ where: { id: input.facilityId }, select: { id: true } }))) throw notFound('Facility');
  const userId = input.userId ?? (await onCallAt(tx, input.startsAt, { departmentIds: [input.departmentId] }))[0];
  if (!userId) throw conflict('NOBODY_ON_CALL', 'Nobody is on call then. Choose who to call back.');
  await assertPerson(tx, a, d.positionIds, userId);
  await lockForAssignment(tx, { userIds: [userId] });
  const actor = { userId: a.userId, tenantId: a.tenantId };
  const shift = await createShift(tx, actor, { facilityId: input.facilityId, positionId: input.positionId, startsAt: input.startsAt, endsAt: input.endsAt, shiftType: 'CUSTOM', customTitle: `Call-back: ${input.reason}`, callBack: true });
  const bundle = (await loadShiftBundle(tx, shift.id))!;
  const c = await loadCandidate(tx, bundle, userId);
  if (!c) throw notFound('Staff member');
  const e = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
  const hard = e.blocks.filter((b) => !REST_CODES.has(b.code));
  const rest = e.blocks.filter((b) => REST_CODES.has(b.code));
  if (hard.length || (rest.length && !input.emergency)) throw new HttpError(422, rest.length && !hard.length ? 'CALLBACK_REST' : 'NOT_ELIGIBLE', rest.length && !hard.length ? 'This call-back breaks the rest rules. Confirm it’s an emergency to call them anyway.' : 'This person cannot work this call-back.', { blocks: e.blocks });
  await tx.shift.update({ where: { id: shift.id }, data: { userId, status: 'PUBLISHED', version: { increment: 1 } } });
  // The ledger counts a call-back like any overtime the agreement equalizes.
  await tx.overtimeEntry.create({ data: { tenantId: a.tenantId, userId, positionId: input.positionId, shiftId: shift.id, kind: 'ACCEPTED', hours: ((input.endsAt.getTime() - input.startsAt.getTime()) / 3_600_000).toFixed(2), occurredAt: new Date(), recordedById: a.userId, note: `Call-back: ${input.reason}` } });
  // Rest after the call-back: the next shift that starts too soon after it.
  const restHours = bundle.rules.rest.betweenShiftsHours ?? 8;
  const next = await tx.shift.findFirst({ where: { userId, status: { not: 'CANCELLED' }, id: { not: shift.id }, startsAt: { gte: input.endsAt, lt: new Date(input.endsAt.getTime() + restHours * 3_600_000) } }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'oncall.callback', entity: 'Shift', entityId: shift.id, after: { userId, reason: input.reason, emergency: !!input.emergency, restBlocks: rest.map((b) => b.code), nextShiftTooSoon: next?.id ?? null } });
  const name = await nameOf(tx, userId);
  const drafts: NotificationDraft[] = [{ userId, type: 'callback_requested', params: { reason: input.reason, shiftId: shift.id }, link: '/schedule', sms: 'text' }];
  if (next || rest.length) {
    const managers = await tx.departmentManager.findMany({ where: { departmentId: input.departmentId }, select: { userId: true } });
    for (const m of new Set([a.userId, ...managers.map((x) => x.userId)])) drafts.push({ userId: m, type: 'callback_rest', params: { name, shiftId: next?.id ?? shift.id }, link: '/manage/schedule' });
  }
  return { shiftId: shift.id, userId, emergencyOverride: rest.length > 0, nextShiftTooSoon: next ? { shiftId: next.id, startsAt: next.startsAt.toISOString(), restHours } : null, drafts };
}
