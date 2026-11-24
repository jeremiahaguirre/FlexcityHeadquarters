/**
 * Leave types an organization offers (LeaveType). Every organization starts with the six system
 * types, one for each TimeOffType value (vacation, sick, protected leave, unpaid personal, other,
 * time in lieu), with exactly the behaviour they always had. They're seeded by migration for
 * existing organizations and on first use for new ones (ensureLeaveTypes). An organization adds its
 * own (bereavement, union leave, jury duty…) with English and French names and:
 *
 * - paid: a city type's approved hours are paid in pay runs and the provider export as LEAVE_PAY,
 *   under the type's own pay code when it has one. System types keep their own pay rules
 *   (vacation is paid as vacation pay; time in lieu from the bank; the rest as before).
 * - hasBalance and yearlyHours: shown in leave balances with this yearly entitlement (HR can still
 *   set one per person); carryOverMaxHours caps what HR may carry into the next year.
 * - protectedLeave: like sick days and protected leave, refusing needs a written reason.
 * - approvalChain: who decides, in order. Empty: as before, anyone who approves time off for the
 *   person (their manager first). ['MANAGER', 'HR']: the manager's approval passes it on to HR
 *   (leave.manage), whose approval completes it.
 *
 * A city type's requests are stored with type OTHER and the LeaveType id, so a version of the app
 * from before leave types reads them as "other" (expand/contract: nothing is dropped or renamed).
 */
import type { LeaveType, TimeOffType } from '../../generated/prisma/client.js';
import type { Tx } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

export const SYSTEM_TYPES: TimeOffType[] = ['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER', 'LIEU'];
export type ApprovalStep = 'MANAGER' | 'HR';

/** The system types as they always behaved. Names match the app's own labels (web locales timeOff.types). */
export const SYSTEM_DEFAULTS: Record<TimeOffType, { name: string; nameFr: string; paid: boolean; hasBalance: boolean; protectedLeave: boolean; sortOrder: number }> = {
  VACATION: { name: 'Vacation', nameFr: 'Vacances', paid: true, hasBalance: true, protectedLeave: false, sortOrder: 1 },
  SICK: { name: 'Sick day', nameFr: 'Congé de maladie', paid: true, hasBalance: true, protectedLeave: true, sortOrder: 2 },
  PROTECTED_LEAVE: { name: 'Protected leave', nameFr: 'Congé protégé', paid: false, hasBalance: true, protectedLeave: true, sortOrder: 3 },
  UNPAID_PERSONAL: { name: 'Unpaid personal day', nameFr: 'Congé personnel non payé', paid: false, hasBalance: true, protectedLeave: false, sortOrder: 4 },
  OTHER: { name: 'Other', nameFr: 'Autre', paid: false, hasBalance: true, protectedLeave: false, sortOrder: 5 },
  LIEU: { name: 'Time in lieu', nameFr: 'Congé compensatoire', paid: true, hasBalance: false, protectedLeave: false, sortOrder: 6 },
};

/** Creates any missing system type for the organization (new organizations; safe to re-run). */
export async function ensureLeaveTypes(tx: Tx, tenantId: string): Promise<void> {
  const have = await tx.leaveType.count({ where: { system: { not: null } } });
  if (have >= SYSTEM_TYPES.length) return;
  await tx.leaveType.createMany({
    data: SYSTEM_TYPES.map((s) => ({ tenantId, system: s, code: s, ...SYSTEM_DEFAULTS[s] })),
    skipDuplicates: true,
  });
}

/** The organization's leave types in order (archived ones only when asked). */
export async function leaveTypes(tx: Tx, tenantId: string, opts: { archived?: boolean } = {}): Promise<LeaveType[]> {
  await ensureLeaveTypes(tx, tenantId);
  return tx.leaveType.findMany({ where: opts.archived ? {} : { archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
}

export const chainOf = (t: Pick<LeaveType, 'approvalChain'>): ApprovalStep[] => (Array.isArray(t.approvalChain) ? (t.approvalChain as unknown[]).filter((s): s is ApprovalStep => s === 'MANAGER' || s === 'HR') : []);

/**
 * The type a new request is for: a system type by its TimeOffType, or the organization's own by
 * id. Returns what to store (type and leaveTypeId).
 */
export async function resolveLeaveType(tx: Tx, tenantId: string, input: { type?: TimeOffType | null; leaveTypeId?: string | null }): Promise<{ type: TimeOffType; leaveType: LeaveType }> {
  await ensureLeaveTypes(tx, tenantId);
  const lt = input.leaveTypeId ? await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } }) : input.type ? await tx.leaveType.findFirst({ where: { system: input.type } }) : null;
  if (!lt) throw new HttpError(400, 'LEAVE_TYPE_UNKNOWN', 'That kind of leave isn’t offered here.');
  if (lt.archivedAt) throw new HttpError(400, 'LEAVE_TYPE_ARCHIVED', 'That kind of leave is no longer offered.');
  return { type: lt.system ?? 'OTHER', leaveType: lt };
}

/** The leave type of a stored request: its own, or (requests from before leave types) the system type of its TimeOffType. */
export async function typeOfRequest(tx: Tx, tenantId: string, r: { type: TimeOffType; leaveTypeId: string | null }): Promise<LeaveType> {
  if (r.leaveTypeId) {
    const lt = await tx.leaveType.findUnique({ where: { id: r.leaveTypeId } });
    if (lt) return lt;
  }
  await ensureLeaveTypes(tx, tenantId);
  return tx.leaveType.findFirstOrThrow({ where: { system: r.type } });
}

/** A short view for screens and lists. */
export const leaveTypeView = (t: Pick<LeaveType, 'id' | 'code' | 'name' | 'nameFr' | 'system'>) => ({ id: t.id, code: t.code, name: t.name, nameFr: t.nameFr, system: t.system });
