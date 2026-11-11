/**
 * Schedule change notice (collective-agreement style): when a PUBLISHED shift changes time or
 * person, record the change, the notice it gave and, when the notice is shorter than the
 * department's rule (workRules.notice.lateChangeHours), the premium it earns. Premiums flow into
 * payroll (workRulePay.ts) in the period of the shift's date; a manager can waive one (audited).
 *
 * Only changes a scheduler makes count (shift edits, assign/unassign, cancel, planner moves).
 * Shift trades and Shift Board claims are the person's own choice and earn nothing.
 */
import type { Shift } from '@prisma/client';
import { type Tx, audit } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { localDate } from '../../lib/time.js';
import type { NotificationDraft } from '../notifications/notifier.js';
import { type ChangeKind, type NoticeResult, changeNotice, effectiveWorkRules, parseWorkRules } from './workRules.js';

type ShiftState = Pick<Shift, 'id' | 'userId' | 'startsAt' | 'endsAt' | 'status' | 'positionId' | 'facilityId'>;

export interface ChangeEffect extends NoticeResult {
  userId: string;
  kind: ChangeKind;
}

/** The people a change affects and the notice each gets (nothing for drafts). */
export async function changeEffects(tx: Tx, before: ShiftState, after: Pick<ShiftState, 'userId' | 'startsAt' | 'endsAt' | 'status'>, now = new Date()): Promise<ChangeEffect[]> {
  if (before.status !== 'PUBLISHED') return [];
  const [tenant, position] = await Promise.all([tx.tenant.findFirstOrThrow({ select: { workRules: true } }), tx.position.findUnique({ where: { id: before.positionId }, select: { departmentId: true } })]);
  const notice = effectiveWorkRules(parseWorkRules(tenant.workRules), position?.departmentId ?? null).notice;
  const old = { start: before.startsAt, end: before.endsAt };
  const next = { start: after.startsAt, end: after.endsAt };
  const cancelled = after.status === 'CANCELLED';
  const out: ChangeEffect[] = [];
  // Changes in the past (a correction after the fact) aren't notice questions.
  if (Math.max(before.endsAt.getTime(), after.endsAt.getTime()) <= now.getTime()) return out;
  if (before.userId && (cancelled || after.userId !== before.userId)) {
    out.push({ userId: before.userId, kind: 'REMOVED', ...changeNotice({ kind: 'REMOVED', old, next: null, now }, notice) });
  } else if (before.userId && (old.start.getTime() !== next.start.getTime() || old.end.getTime() !== next.end.getTime())) {
    out.push({ userId: before.userId, kind: 'TIME', ...changeNotice({ kind: 'TIME', old, next, now }, notice) });
  }
  if (!cancelled && after.userId && after.userId !== before.userId) {
    out.push({ userId: after.userId, kind: 'ADDED', ...changeNotice({ kind: 'ADDED', old: null, next, now }, notice) });
  }
  return out;
}

/**
 * Records a change to a published shift; late ones carry their premium and tell the person.
 * Returns notification drafts for late changes (the caller's events send them).
 */
export async function recordShiftChange(tx: Tx, actor: { tenantId: string; userId: string }, before: ShiftState, after: Pick<ShiftState, 'userId' | 'startsAt' | 'endsAt' | 'status'>, now = new Date()): Promise<NotificationDraft[]> {
  const effects = await changeEffects(tx, before, after, now);
  if (!effects.length) return [];
  const tz = (await tx.facility.findUnique({ where: { id: before.facilityId }, select: { timezone: true } }))?.timezone ?? 'America/Toronto';
  const drafts: NotificationDraft[] = [];
  for (const e of effects) {
    const payAt = e.kind === 'REMOVED' ? before.startsAt : after.startsAt;
    const row = await tx.shiftChange.create({
      data: {
        tenantId: actor.tenantId,
        shiftId: before.id,
        userId: e.userId,
        positionId: before.positionId,
        kind: e.kind,
        oldStartsAt: e.kind === 'ADDED' ? null : before.startsAt,
        oldEndsAt: e.kind === 'ADDED' ? null : before.endsAt,
        newStartsAt: e.kind === 'REMOVED' ? null : after.startsAt,
        newEndsAt: e.kind === 'REMOVED' ? null : after.endsAt,
        noticeHours: e.noticeHours,
        requiredHours: e.requiredHours,
        late: e.late,
        premiumHours: e.premiumHours || null,
        multiplier: e.multiplier,
        flatAmount: e.flatAmount,
        payOn: e.late && (e.premiumHours || e.flatAmount) ? new Date(`${localDate(payAt, tz)}T00:00:00Z`) : null,
        changedById: actor.userId,
      },
    });
    if (e.late) {
      await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.late_change', entity: 'ShiftChange', entityId: row.id, after: { shiftId: before.id, userId: e.userId, kind: e.kind, noticeHours: e.noticeHours, requiredHours: e.requiredHours, premiumHours: e.premiumHours, flatAmount: e.flatAmount } });
      drafts.push({ userId: e.userId, type: 'schedule_late_change', params: { shiftId: before.id, hours: String(e.noticeHours), premium: e.premiumHours || e.flatAmount ? 'yes' : 'no' }, link: '/schedule' });
    }
  }
  return drafts;
}

/** Waives a recorded premium (the agreement allows it, or the person asked for the change). */
export async function waiveShiftChange(tx: Tx, actor: { tenantId: string; userId: string }, id: string, reason: string) {
  const c = await tx.shiftChange.findUnique({ where: { id } });
  if (!c) throw notFound('Change');
  if (c.waivedAt) return c;
  const out = await tx.shiftChange.update({ where: { id }, data: { waivedAt: new Date(), waivedById: actor.userId, waiveReason: reason } });
  await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.late_change.waive', entity: 'ShiftChange', entityId: id, before: { waivedAt: null }, after: { reason } });
  return out;
}
