/**
 * Schedule change notice (collective-agreement style): when a PUBLISHED shift changes time or
 * person, record the change, the notice it gave and, when the notice is shorter than the
 * department's rule (workRules.notice.lateChangeHours), the premium it earns. Premiums flow into
 * payroll (workRulePay.ts) in the period of the shift's date; a manager can waive one (audited).
 *
 * Only changes a scheduler makes count (shift edits, assign/unassign, cancel, planner moves).
 * Shift trades and Shift Board claims are the person's own choice and earn nothing.
 */
import type { Shift } from '../../generated/prisma/client.js';
import { type Tx, audit } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { localDate } from '../../lib/time.js';
import type { NotificationDraft } from '../notifications/notifier.js';
import { type ChangeKind, type NoticeResult, changeNotice, effectiveWorkRules, parseWorkRules } from './workRules.js';

/** The waive reason on a premium replaced by a later change to the same shift. */
export const SUPERSEDED = 'Superseded by a later change to the same shift';

type ShiftState = Pick<Shift, 'id' | 'userId' | 'startsAt' | 'endsAt' | 'status' | 'positionId' | 'facilityId'>;

export interface ChangeEffect extends NoticeResult {
  userId: string;
  kind: ChangeKind;
  /** Earlier late-change premiums on this shift for this person that this change replaces. */
  supersedes: string[];
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
    out.push({ userId: before.userId, kind: 'REMOVED', supersedes: [], ...changeNotice({ kind: 'REMOVED', old, next: null, now }, notice) });
  } else if (before.userId && (old.start.getTime() !== next.start.getTime() || old.end.getTime() !== next.end.getTime())) {
    out.push({ userId: before.userId, kind: 'TIME', supersedes: [], ...changeNotice({ kind: 'TIME', old, next, now }, notice) });
  }
  if (!cancelled && after.userId && after.userId !== before.userId) {
    out.push({ userId: after.userId, kind: 'ADDED', supersedes: [], ...changeNotice({ kind: 'ADDED', old: null, next, now }, notice) });
  }
  // A shift changed again: the changed-hours premium is measured against the person's times
  // before the first late change still standing (09:00–17:00 → 09:00–19:00 → 09:00–17:00 earns
  // nothing in all; → 09:00–20:00 earns 3 h in all, not 2 + 1 + …), and replaces the earlier ones.
  // Removing the person drops those premiums (they won't work the hours). Flat premiums are per change.
  for (const e of out) {
    if (!e.late || e.flatAmount) continue;
    const chain = await tx.shiftChange.findMany({ where: { shiftId: before.id, userId: e.userId, late: true, waivedAt: null, premiumHours: { not: null } }, orderBy: { createdAt: 'asc' } });
    if (!chain.length) continue;
    e.supersedes = chain.map((c) => c.id);
    if (e.kind === 'REMOVED') continue;
    const first = chain[0]!;
    const baseline = first.kind === 'ADDED' || !first.oldStartsAt || !first.oldEndsAt ? null : { start: first.oldStartsAt, end: first.oldEndsAt };
    const r = changeNotice({ kind: baseline ? 'TIME' : 'ADDED', old: baseline, next, now }, notice);
    e.premiumHours = r.premiumHours;
    e.multiplier = r.multiplier;
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
    if (e.supersedes.length) {
      await tx.shiftChange.updateMany({ where: { id: { in: e.supersedes }, waivedAt: null }, data: { waivedAt: now, waivedById: actor.userId, waiveReason: SUPERSEDED } });
      await audit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'shift.late_change.superseded', entity: 'Shift', entityId: before.id, after: { userId: e.userId, superseded: e.supersedes } });
    }
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
