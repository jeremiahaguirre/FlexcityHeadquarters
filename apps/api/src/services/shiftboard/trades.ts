/**
 * Shift trades: two people swap shifts, each taking the other's.
 *
 * Each side is checked for the shift they'd take as if their own traded shift
 * were already gone (so swapping two overlapping shifts works). The other
 * person agrees first, then a supervisor approves; at approval both shifts are
 * checked again and swapped together with a compare-and-set on each shift's
 * version, so a trade never half-happens and never undoes someone else's change.
 */
import type { Prisma } from '@prisma/client';
import { type Tx, advisoryLock, audit } from '../../lib/db.js';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { evaluateCandidate } from '../scheduling/eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from '../scheduling/eligibilityLoader.js';
import { chargeOvertime, reverseOvertime } from '../scheduling/overtime.js';
import { lockForAssignment } from '../scheduling/locks.js';

export interface Side { userId: string; shiftId: string; eligible: boolean; overtimeHours: string; blocks: Array<{ code: string; message: string }> }
export interface TradeCheck { from: Side; to: Side; versions: { from: number; to: number } }

/** The two shifts as they stand, and whether each person can take the other's. */
export async function checkTrade(tx: Tx, fromShiftId: string, toShiftId: string): Promise<TradeCheck> {
  const [a, b] = await Promise.all([loadShiftBundle(tx, fromShiftId), loadShiftBundle(tx, toShiftId)]);
  if (!a || !b) throw notFound('Shift');
  const now = new Date();
  for (const x of [a, b]) {
    if (x.shift.status !== 'PUBLISHED') throw conflict('SHIFT_NOT_PUBLISHED', 'Only published shifts can be traded.');
    if (x.shift.start <= now) throw conflict('SHIFT_STARTED', 'One of these shifts has already started.');
    if (!x.shift.userId) throw conflict('SHIFT_OPEN', 'Open shifts are taken from the board, not traded.');
  }
  const fromUser = a.shift.userId!;
  const toUser = b.shift.userId!;
  if (fromUser === toUser) throw conflict('SAME_PERSON', 'Both shifts are yours.');
  const side = async (userId: string, takes: typeof a, gives: string): Promise<Side> => {
    const c = await loadCandidate(tx, takes, userId, [gives]);
    if (!c) throw notFound('User');
    const e = evaluateCandidate(c, takes.shift, takes.position, evalOpts(takes));
    return { userId, shiftId: takes.shift.id, eligible: e.eligible, overtimeHours: e.overtimeHours.toFixed(2), blocks: e.blocks.map((x) => ({ code: x.code, message: x.message })) };
  };
  // "from" takes the other shift; "to" takes from's shift.
  return { from: await side(fromUser, b, a.shift.id), to: await side(toUser, a, b.shift.id), versions: { from: a.shift.version, to: b.shift.version } };
}

const ACTIVE = ['PROPOSED', 'ACCEPTED'] as const;

async function shiftsFree(tx: Tx, shiftIds: string[], ignoreTradeId?: string) {
  const trade = await tx.shiftTrade.findFirst({ where: { status: { in: [...ACTIVE] }, OR: [{ fromShiftId: { in: shiftIds } }, { toShiftId: { in: shiftIds } }], ...(ignoreTradeId ? { id: { not: ignoreTradeId } } : {}) } });
  if (trade) throw conflict('ALREADY_TRADING', 'One of these shifts is already part of a trade.');
  const offer = await tx.shiftOffer.findFirst({ where: { shiftId: { in: shiftIds }, status: { in: ['OPEN', 'PENDING_APPROVAL'] } } });
  if (offer) throw conflict('ALREADY_POSTED', 'One of these shifts is on the shift board.');
}

export async function proposeTrade(tx: Tx, tenantId: string, userId: string, myShiftId: string, theirShiftId: string, note: string | null) {
  await advisoryLock(tx, `shift:${[myShiftId, theirShiftId].sort()[0]}`);
  await advisoryLock(tx, `shift:${[myShiftId, theirShiftId].sort()[1]}`);
  const mine = await tx.shift.findUnique({ where: { id: myShiftId }, select: { userId: true } });
  if (!mine) throw notFound('Shift');
  if (mine.userId !== userId) throw forbidden('You can only trade your own shifts.');
  await shiftsFree(tx, [myShiftId, theirShiftId]);
  const check = await checkTrade(tx, myShiftId, theirShiftId);
  if (!check.from.eligible) throw new HttpError(422, 'NOT_ELIGIBLE', 'You can’t take that shift.', { blocks: check.from.blocks });
  if (!check.to.eligible) throw new HttpError(422, 'PARTNER_NOT_ELIGIBLE', 'They can’t take your shift.', { blocks: check.to.blocks });
  const trade = await tx.shiftTrade.create({ data: { tenantId, fromUserId: userId, fromShiftId: myShiftId, toUserId: check.to.userId, toShiftId: theirShiftId, note, check: check as unknown as Prisma.InputJsonValue } });
  await audit(tx, { tenantId, actorId: userId, action: 'trade.propose', entity: 'ShiftTrade', entityId: trade.id, after: { myShiftId, theirShiftId } });
  return trade;
}

export async function respondTrade(tx: Tx, tenantId: string, userId: string, id: string, accept: boolean) {
  const t = await tx.shiftTrade.findUnique({ where: { id } });
  if (!t || t.toUserId !== userId) throw notFound('Trade');
  if (t.status !== 'PROPOSED') throw conflict('NOT_PROPOSED', 'This trade is no longer waiting for you.');
  if (accept) {
    const check = await checkTrade(tx, t.fromShiftId, t.toShiftId);
    if (check.from.userId !== t.fromUserId || check.to.userId !== t.toUserId || !check.from.eligible || !check.to.eligible) {
      // Closed, and kept closed: the caller reports TRADE_STALE after this transaction commits.
      await tx.shiftTrade.update({ where: { id }, data: { status: 'EXPIRED', check: check as unknown as Prisma.InputJsonValue } });
      return { trade: t, stale: true as const };
    }
    await tx.shiftTrade.update({ where: { id }, data: { status: 'ACCEPTED', respondedAt: new Date(), check: check as unknown as Prisma.InputJsonValue } });
  } else {
    await tx.shiftTrade.update({ where: { id }, data: { status: 'DECLINED', respondedAt: new Date() } });
  }
  await audit(tx, { tenantId, actorId: userId, action: accept ? 'trade.accept' : 'trade.decline', entity: 'ShiftTrade', entityId: id });
  return { trade: t, stale: false as const };
}

export const staleTrade = () => conflict('TRADE_STALE', 'One of the shifts changed, or someone is no longer eligible. The trade was closed.');

/** A supervisor approves: both shifts swap together, or nothing changes. */
export async function approveTrade(tx: Tx, tenantId: string, actorId: string, id: string, note: string | null) {
  const t = await tx.shiftTrade.findUnique({ where: { id } });
  if (!t) throw notFound('Trade');
  if (t.status !== 'ACCEPTED') throw conflict('NOT_ACCEPTED', 'Only trades both people agreed to can be approved.');
  if (actorId === t.fromUserId || actorId === t.toUserId) throw forbidden('You can’t approve a trade you’re part of.');
  await advisoryLock(tx, `shift:${[t.fromShiftId, t.toShiftId].sort()[0]}`);
  await advisoryLock(tx, `shift:${[t.fromShiftId, t.toShiftId].sort()[1]}`);
  // Then both people (sorted), as every assigning path does.
  await lockForAssignment(tx, { userIds: [t.fromUserId, t.toUserId] });
  const check = await checkTrade(tx, t.fromShiftId, t.toShiftId);
  if (check.from.userId !== t.fromUserId || check.to.userId !== t.toUserId || !check.from.eligible || !check.to.eligible) {
    await tx.shiftTrade.update({ where: { id }, data: { status: 'EXPIRED', check: check as unknown as Prisma.InputJsonValue } });
    return { trade: t, stale: true as const };
  }
  const a = await tx.shift.updateMany({ where: { id: t.fromShiftId, version: check.versions.from, userId: t.fromUserId }, data: { userId: t.toUserId, version: { increment: 1 }, conflictReason: null } });
  const b = await tx.shift.updateMany({ where: { id: t.toShiftId, version: check.versions.to, userId: t.toUserId }, data: { userId: t.fromUserId, version: { increment: 1 }, conflictReason: null } });
  if (a.count !== 1 || b.count !== 1) throw conflict('SHIFT_CHANGED', 'A shift changed while approving. Nothing was swapped; try again.');
  await tx.shiftTrade.update({ where: { id }, data: { status: 'APPROVED', decidedById: actorId, decidedAt: new Date(), decisionNote: note, check: check as unknown as Prisma.InputJsonValue } });
  // Overtime charged for the shifts each person gave away comes off; overtime the trade creates is
  // charged like any other, so the overtime order stays fair.
  await reverseOvertime(tx, tenantId, actorId, t.fromUserId, t.fromShiftId, 'Traded away');
  await reverseOvertime(tx, tenantId, actorId, t.toUserId, t.toShiftId, 'Traded away');
  const [sa, sb] = await Promise.all([tx.shift.findUniqueOrThrow({ where: { id: t.fromShiftId } }), tx.shift.findUniqueOrThrow({ where: { id: t.toShiftId } })]);
  if (Number(check.from.overtimeHours) > 0) await chargeOvertime(tx, tenantId, actorId, t.fromUserId, sb.id, check.from.overtimeHours, sb.positionId);
  if (Number(check.to.overtimeHours) > 0) await chargeOvertime(tx, tenantId, actorId, t.toUserId, sa.id, check.to.overtimeHours, sa.positionId);
  await audit(tx, { tenantId, actorId, action: 'trade.approve', entity: 'ShiftTrade', entityId: id, after: { swapped: [t.fromShiftId, t.toShiftId] } });
  return { trade: t, stale: false as const };
}

export async function denyTrade(tx: Tx, tenantId: string, actorId: string, id: string, note: string | null) {
  const t = await tx.shiftTrade.findUnique({ where: { id } });
  if (!t) throw notFound('Trade');
  if (t.status !== 'ACCEPTED' && t.status !== 'PROPOSED') throw conflict('NOT_OPEN', 'This trade is already closed.');
  await tx.shiftTrade.update({ where: { id }, data: { status: 'DENIED', decidedById: actorId, decidedAt: new Date(), decisionNote: note } });
  await audit(tx, { tenantId, actorId, action: 'trade.deny', entity: 'ShiftTrade', entityId: id, after: { note } });
  return t;
}
