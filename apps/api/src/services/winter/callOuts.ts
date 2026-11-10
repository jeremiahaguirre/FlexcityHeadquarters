/**
 * Winter storm call-outs. Overtime goes out in the collective agreement's
 * order (fewest overtime hours, then seniority), one person at a time:
 * - people who can't take it are skipped with the reason (too little rest,
 *   weekly limits, missing licence or certificate, time off);
 * - each person has the city's response time to answer, in the app or by
 *   phone (a supervisor records it); no answer moves to the next person;
 * - every acceptance, refusal and non-answer goes on the overtime ledger.
 */
import type { CallOut, CallOutContact } from '@prisma/client';
import { type Tx, audit } from '../../lib/db.js';
import { conflict, notFound } from '../../lib/errors.js';
import { notify } from '../notifications/notifier.js';
import { evaluateCandidate } from '../scheduling/eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from '../scheduling/eligibilityLoader.js';
import { standings } from '../scheduling/overtime.js';
import { winterSettings } from './settings.js';

interface Actor { tenantId: string; userId: string }
export interface CallOutInput { facilityId: string; positionId: string; reason: string; startsAt: Date; endsAt: Date }

const hours = (c: Pick<CallOut, 'startsAt' | 'endsAt'>) => ((c.endsAt.getTime() - c.startsAt.getTime()) / 3_600_000).toFixed(2);

export async function createCallOut(tx: Tx, actor: Actor, input: CallOutInput, now = new Date()) {
  if (input.endsAt <= input.startsAt) throw conflict('BAD_TIMES', 'The call-out must end after it starts.');
  const settings = await winterSettings(tx);
  const shift = await tx.shift.create({
    data: { tenantId: actor.tenantId, facilityId: input.facilityId, positionId: input.positionId, startsAt: input.startsAt, endsAt: input.endsAt, status: 'PUBLISHED', shiftType: 'CUSTOM', customTitle: `Call-out: ${input.reason}` },
  });
  const callOut = await tx.callOut.create({
    data: { tenantId: actor.tenantId, facilityId: input.facilityId, positionId: input.positionId, shiftId: shift.id, reason: input.reason, startsAt: input.startsAt, endsAt: input.endsAt, responseMinutes: settings.callOuts.responseMinutes, createdById: actor.userId },
  });
  // The list, in overtime order, with anyone who can't take it skipped and why.
  const bundle = (await loadShiftBundle(tx, shift.id))!;
  const { rows } = await standings(tx, input.positionId, now);
  let rank = 0;
  for (const r of rows) {
    if (r.userId === actor.userId) continue;
    const c = await loadCandidate(tx, bundle, r.userId);
    const e = c ? evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle)) : null;
    // A short rest before or after is the most common reason in a storm.
    const restBlock = await tooLittleRest(tx, r.userId, input, settings.callOuts.minRestHours);
    const reason = !e ? 'NOT_ELIGIBLE' : !e.eligible ? e.blocks[0]?.code ?? 'NOT_ELIGIBLE' : restBlock;
    await tx.callOutContact.create({ data: { tenantId: actor.tenantId, callOutId: callOut.id, userId: r.userId, rank: rank++, status: reason ? 'SKIPPED' : 'WAITING', skipReason: reason ?? null } });
  }
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'callout.create', entity: 'CallOut', entityId: callOut.id, after: { reason: input.reason, startsAt: input.startsAt, endsAt: input.endsAt } });
  await offerNext(tx, callOut, now);
  return callOut;
}

async function tooLittleRest(tx: Tx, userId: string, c: Pick<CallOutInput, 'startsAt' | 'endsAt'>, minRestHours: number): Promise<string | null> {
  const gap = minRestHours * 3_600_000;
  const near = await tx.shift.count({
    where: { userId, status: 'PUBLISHED', startsAt: { lt: new Date(c.endsAt.getTime() + gap) }, endsAt: { gt: new Date(c.startsAt.getTime() - gap) } },
  });
  return near ? 'TOO_LITTLE_REST' : null;
}

/** Offers the call-out to the next person in line, or tells the supervisor the list ran out. */
export async function offerNext(tx: Tx, callOut: CallOut, now = new Date()) {
  if (callOut.status !== 'OPEN') return null;
  if (await tx.callOutContact.count({ where: { callOutId: callOut.id, status: 'OFFERED' } })) return null;
  const next = await tx.callOutContact.findFirst({ where: { callOutId: callOut.id, status: 'WAITING' }, orderBy: { rank: 'asc' } });
  const facility = await tx.facility.findUnique({ where: { id: callOut.facilityId }, select: { name: true } });
  const params = { reason: callOut.reason, facility: facility?.name ?? '', minutes: callOut.responseMinutes, startsAt: callOut.startsAt.toISOString() };
  if (!next) {
    await notify(tx, callOut.tenantId, [{ userId: callOut.createdById, type: 'callout_exhausted', params, link: '/manage/call-outs' }]);
    return null;
  }
  await tx.callOutContact.update({ where: { id: next.id }, data: { status: 'OFFERED', offeredAt: now } });
  await notify(tx, callOut.tenantId, [{ userId: next.userId, type: 'callout_offer', params, link: '/call-outs', email: 'callout_offer', sms: 'text' }]);
  return next;
}

export type Answer = 'ACCEPTED' | 'DECLINED' | 'NO_ANSWER';

/** An answer from the person (in the app) or recorded by a supervisor (by phone). */
export async function answer(tx: Tx, contact: CallOutContact, ans: Answer, recordedBy: string | null, now = new Date()) {
  const callOut = await tx.callOut.findUnique({ where: { id: contact.callOutId } });
  if (!callOut) throw notFound('Call-out');
  if (callOut.status !== 'OPEN') throw conflict('CALLOUT_CLOSED', 'This call-out has already been filled or cancelled.');
  if (contact.status !== 'OFFERED' && contact.status !== 'WAITING') throw conflict('ALREADY_ANSWERED', 'This answer is already recorded.');
  await tx.callOutContact.update({ where: { id: contact.id }, data: { status: ans, respondedAt: now, recordedById: recordedBy } });
  // Every answer goes on the overtime ledger, as the agreement counts them.
  await tx.overtimeEntry.create({
    data: { tenantId: callOut.tenantId, userId: contact.userId, positionId: callOut.positionId, shiftId: callOut.shiftId, kind: ans === 'ACCEPTED' ? 'ACCEPTED' : ans === 'DECLINED' ? 'REFUSED' : 'NO_ANSWER', hours: hours(callOut), occurredAt: now, recordedById: recordedBy ?? contact.userId, note: `Call-out: ${callOut.reason}` },
  });
  if (ans === 'ACCEPTED') {
    await tx.shift.update({ where: { id: callOut.shiftId }, data: { userId: contact.userId, version: { increment: 1 } } });
    await tx.callOut.update({ where: { id: callOut.id }, data: { status: 'FILLED', filledUserId: contact.userId, closedAt: now } });
    await tx.callOutContact.updateMany({ where: { callOutId: callOut.id, status: { in: ['WAITING', 'OFFERED'] } }, data: { status: 'NOT_NEEDED' } });
    const u = await tx.user.findUnique({ where: { id: contact.userId }, select: { firstName: true, lastName: true } });
    await notify(tx, callOut.tenantId, [
      { userId: callOut.createdById, type: 'callout_filled', params: { name: u ? `${u.firstName} ${u.lastName}` : '', reason: callOut.reason }, link: '/manage/call-outs' },
      { userId: contact.userId, type: 'shift_assigned', link: '/schedule' },
    ]);
  } else {
    await offerNext(tx, callOut, now);
  }
  await audit(tx, { tenantId: callOut.tenantId, actorId: recordedBy ?? contact.userId, action: `callout.${ans.toLowerCase()}`, entity: 'CallOut', entityId: callOut.id, after: { userId: contact.userId } });
}

export async function cancelCallOut(tx: Tx, actor: Actor, id: string, now = new Date()) {
  const c = await tx.callOut.findUnique({ where: { id } });
  if (!c) throw notFound('Call-out');
  if (c.status !== 'OPEN') throw conflict('CALLOUT_CLOSED', 'This call-out has already been filled or cancelled.');
  await tx.callOut.update({ where: { id }, data: { status: 'CANCELLED', closedAt: now } });
  const offered = await tx.callOutContact.findMany({ where: { callOutId: id, status: 'OFFERED' } });
  await tx.callOutContact.updateMany({ where: { callOutId: id, status: { in: ['WAITING', 'OFFERED'] } }, data: { status: 'NOT_NEEDED' } });
  await tx.shift.update({ where: { id: c.shiftId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
  await notify(tx, c.tenantId, offered.map((o) => ({ userId: o.userId, type: 'callout_cancelled', params: { reason: c.reason }, link: '/call-outs' })));
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'callout.cancel', entity: 'CallOut', entityId: id });
}

/** Minutely: offers nobody answered in time count as no answer, and the next person is asked. */
export async function callOutTimeouts(tx: Tx, now = new Date()): Promise<number> {
  const offered = await tx.callOutContact.findMany({ where: { status: 'OFFERED' }, include: { callOut: true } });
  let n = 0;
  for (const o of offered) {
    if (o.callOut.status !== 'OPEN' || !o.offeredAt) continue;
    if (o.offeredAt.getTime() + o.callOut.responseMinutes * 60_000 > now.getTime()) continue;
    await answer(tx, o, 'NO_ANSWER', null, now);
    n++;
  }
  return n;
}
