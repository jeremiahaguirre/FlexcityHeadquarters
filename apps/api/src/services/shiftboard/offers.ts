/**
 * Shift Board: post / claim / approve / deny / cancel.
 *
 * Fixes over the original design:
 *  - Claim state lives on ShiftOffer, not overloaded onto Shift.status.
 *  - Concurrency: per-shift and per-claimant advisory locks serialise claims,
 *    so two guards can't both win a shift, and one guard can't claim two
 *    shifts at once and slip past the overtime check on both. The assignment
 *    itself is a compare-and-set on Shift.version (+ expected holder).
 *  - Eligibility is re-evaluated at approval time — certs, other claims and
 *    time off may have changed since the claim.
 *  - The original holder remains assigned (and responsible) until COMPLETED.
 */
import { chargeOvertime } from '../scheduling/overtime.js';
import { Prisma } from '@prisma/client';
import { type Tx, advisoryLock, audit } from '../../lib/db.js';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors.js';
import type { DomainEvent } from '../../lib/events.js';
import { evaluateCandidate } from '../scheduling/eligibility.js';
import { evalOpts, loadCandidate, loadCandidates, loadShiftBundle } from '../scheduling/eligibilityLoader.js';

const LATE_DROP_HOURS = 24;

export interface Actor {
  userId: string;
  tenantId: string;
  canPostOpenShifts: boolean;
}

export async function postOffer(tx: Tx, actor: Actor, shiftId: string): Promise<{ offerId: string; events: DomainEvent[] }> {
  await advisoryLock(tx, `shift:${shiftId}`);
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) throw notFound('Shift');
  const { shift } = bundle;
  if (shift.status !== 'PUBLISHED') throw conflict('SHIFT_NOT_PUBLISHED', 'Only published shifts can be posted.');
  if (shift.start <= new Date()) throw conflict('SHIFT_STARTED', 'This shift has already started.');

  let source: 'SWAP' | 'OPEN_SHIFT';
  if (shift.userId === actor.userId) source = 'SWAP';
  else if (shift.userId === null && actor.canPostOpenShifts) source = 'OPEN_SHIFT';
  else throw forbidden('You can only post your own shifts.');

  const active = await tx.shiftOffer.findFirst({ where: { shiftId, status: { in: ['OPEN', 'PENDING_APPROVAL'] } } });
  if (active) throw conflict('ALREADY_POSTED', 'This shift is already on the board.', { offerId: active.id });

  const offer = await tx.shiftOffer.create({
    data: { tenantId: actor.tenantId, shiftId, source, postedById: actor.userId },
  });

  if (source === 'SWAP' && shift.start.getTime() - Date.now() < LATE_DROP_HOURS * 3_600_000) {
    await tx.reliabilityEvent.create({
      data: { tenantId: actor.tenantId, userId: actor.userId, type: 'LATE_DROP', occurredAt: new Date(), sourceId: offer.id },
    });
  }

  // Notify ONLY people who could actually take it.
  const candidates = await loadCandidates(tx, bundle);
  const eligibleUserIds = candidates
    .filter((c) => c.userId !== actor.userId)
    .map((c) => ({ c, e: evaluateCandidate(c, shift, bundle.position, evalOpts(bundle)) }))
    .filter(({ e }) => e.eligible)
    .map(({ c }) => c.userId);

  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'offer.post', entity: 'ShiftOffer', entityId: offer.id, after: { shiftId, source } });
  return {
    offerId: offer.id,
    events: [{ type: 'shift.offer.posted', tenantId: actor.tenantId, offerId: offer.id, shiftId, eligibleUserIds }],
  };
}

export type ClaimResult =
  | { outcome: 'ASSIGNED'; events: DomainEvent[] }
  | { outcome: 'PENDING_APPROVAL'; overtimeHours: string; events: DomainEvent[] };

export async function claimOffer(
  tx: Tx,
  actor: Actor,
  offerId: string,
  expectedShiftVersion?: number,
): Promise<ClaimResult> {
  const offer = await tx.shiftOffer.findUnique({ where: { id: offerId } });
  if (!offer) throw notFound('Offer');
  // Lock order is always shift → user, so concurrent claims cannot deadlock.
  await advisoryLock(tx, `shift:${offer.shiftId}`);
  await advisoryLock(tx, `user:${actor.userId}`);

  const fresh = await tx.shiftOffer.findUniqueOrThrow({ where: { id: offerId } });
  if (fresh.status !== 'OPEN') throw conflict('SHIFT_ALREADY_CLAIMED', 'This shift has already been claimed.');
  if (fresh.postedById === actor.userId) throw conflict('OWN_OFFER', 'You cannot claim your own shift.');

  const bundle = await loadShiftBundle(tx, fresh.shiftId);
  if (!bundle) throw notFound('Shift');
  if (expectedShiftVersion !== undefined && expectedShiftVersion !== bundle.shift.version) {
    throw conflict('SHIFT_CHANGED', 'This shift changed since you loaded it. Refresh and try again.');
  }
  if (bundle.shift.start <= new Date()) throw conflict('SHIFT_STARTED', 'This shift has already started.');

  const candidate = await loadCandidate(tx, bundle, actor.userId);
  if (!candidate) throw notFound('User');
  const evaluation = evaluateCandidate(candidate, bundle.shift, bundle.position, evalOpts(bundle));
  if (!evaluation.eligible) {
    throw new HttpError(422, 'NOT_ELIGIBLE', 'You are not eligible for this shift.', { blocks: evaluation.blocks });
  }

  const snapshot = {
    flags: evaluation.flags.map((f) => ({ code: f.code, message: f.message })),
    overtimeHours: evaluation.overtimeHours.toString(),
    weeklyHoursAfter: evaluation.weeklyHoursAfter.toString(),
    evaluatedAt: new Date().toISOString(),
  } satisfies Prisma.InputJsonValue;

  if (evaluation.overtimeHours.gt(0)) {
    await tx.shiftOffer.update({
      where: { id: offerId },
      data: { status: 'PENDING_APPROVAL', claimedById: actor.userId, complianceSnapshot: snapshot },
    });
    await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'offer.claim_pending', entity: 'ShiftOffer', entityId: offerId, after: snapshot });
    return {
      outcome: 'PENDING_APPROVAL',
      overtimeHours: evaluation.overtimeHours.toFixed(2),
      events: [
        {
          type: 'shift.offer.pending_approval',
          tenantId: actor.tenantId,
          offerId,
          shiftId: fresh.shiftId,
          claimantId: actor.userId,
          overtimeHours: evaluation.overtimeHours.toFixed(2),
        },
      ],
    };
  }

  const events = await completeTransfer(tx, actor, fresh.id, bundle.shift.version, bundle.shift.userId, actor.userId, snapshot);
  return { outcome: 'ASSIGNED', events };
}

export async function decideOffer(
  tx: Tx,
  actor: Actor,
  offerId: string,
  decision: 'APPROVE' | 'DENY',
): Promise<DomainEvent[]> {
  const offer = await tx.shiftOffer.findUnique({ where: { id: offerId } });
  if (!offer) throw notFound('Offer');
  await advisoryLock(tx, `shift:${offer.shiftId}`);
  if (offer.claimedById) await advisoryLock(tx, `user:${offer.claimedById}`);

  const fresh = await tx.shiftOffer.findUniqueOrThrow({ where: { id: offerId } });
  if (fresh.status !== 'PENDING_APPROVAL' || !fresh.claimedById) {
    throw conflict('NOT_PENDING', 'This claim is no longer awaiting approval.');
  }
  const claimantId = fresh.claimedById;

  if (decision === 'DENY') {
    await tx.shiftOffer.update({
      where: { id: offerId },
      data: { status: 'OPEN', claimedById: null, complianceSnapshot: Prisma.DbNull, decidedById: actor.userId, decidedAt: new Date() },
    });
    await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'offer.deny', entity: 'ShiftOffer', entityId: offerId });
    return [{ type: 'shift.offer.denied', tenantId: actor.tenantId, offerId, claimantId }];
  }

  // Re-check everything: the world may have changed since the claim.
  const bundle = await loadShiftBundle(tx, fresh.shiftId);
  if (!bundle) throw notFound('Shift');
  const candidate = await loadCandidate(tx, bundle, claimantId);
  if (!candidate) throw notFound('User');
  const evaluation = evaluateCandidate(candidate, bundle.shift, bundle.position, evalOpts(bundle));
  if (!evaluation.eligible) {
    throw new HttpError(422, 'NO_LONGER_ELIGIBLE', 'The claimant is no longer eligible for this shift.', { blocks: evaluation.blocks });
  }
  const snapshot = {
    flags: evaluation.flags.map((f) => ({ code: f.code, message: f.message })),
    overtimeHours: evaluation.overtimeHours.toString(),
    overtimeApprovedBy: actor.userId,
    evaluatedAt: new Date().toISOString(),
  } satisfies Prisma.InputJsonValue;
  const events = await completeTransfer(tx, actor, offerId, bundle.shift.version, bundle.shift.userId, claimantId, snapshot);
  await chargeOvertime(tx, actor.tenantId, actor.userId, claimantId, bundle.shift.id, evaluation.overtimeHours.toFixed(2), bundle.shift.positionId);
  return events;
}

export async function cancelOffer(tx: Tx, actor: Actor, offerId: string): Promise<void> {
  const offer = await tx.shiftOffer.findUnique({ where: { id: offerId } });
  if (!offer) throw notFound('Offer');
  await advisoryLock(tx, `shift:${offer.shiftId}`);
  const fresh = await tx.shiftOffer.findUniqueOrThrow({ where: { id: offerId } });
  if (fresh.postedById !== actor.userId && !actor.canPostOpenShifts) throw forbidden();
  if (fresh.status !== 'OPEN' && fresh.status !== 'PENDING_APPROVAL') throw conflict('NOT_ACTIVE', 'This offer is closed.');
  await tx.shiftOffer.update({ where: { id: offerId }, data: { status: 'CANCELLED' } });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'offer.cancel', entity: 'ShiftOffer', entityId: offerId });
}

async function completeTransfer(
  tx: Tx,
  actor: Actor,
  offerId: string,
  version: number,
  fromUserId: string | null,
  toUserId: string,
  snapshot: Prisma.InputJsonValue,
): Promise<DomainEvent[]> {
  const offer = await tx.shiftOffer.findUniqueOrThrow({ where: { id: offerId } });
  // Compare-and-set: only succeeds if nobody changed the shift since we read it.
  const updated = await tx.shift.updateMany({
    where: { id: offer.shiftId, version, userId: fromUserId },
    data: { userId: toUserId, version: { increment: 1 }, conflictReason: null },
  });
  if (updated.count !== 1) throw conflict('SHIFT_ALREADY_CLAIMED', 'This shift was changed by someone else.');

  await tx.shiftOffer.update({
    where: { id: offerId },
    data: { status: 'COMPLETED', claimedById: toUserId, complianceSnapshot: snapshot, decidedById: actor.userId, decidedAt: new Date() },
  });
  await tx.reliabilityEvent.create({
    data: { tenantId: actor.tenantId, userId: toUserId, type: 'PICKED_UP_SHIFT', occurredAt: new Date(), sourceId: offerId },
  });
  await audit(tx, {
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: 'shift.reassign',
    entity: 'Shift',
    entityId: offer.shiftId,
    before: { userId: fromUserId, version },
    after: { userId: toUserId, version: version + 1, offerId },
  });
  return [{ type: 'shift.offer.completed', tenantId: actor.tenantId, offerId, shiftId: offer.shiftId, fromUserId, toUserId }];
}
