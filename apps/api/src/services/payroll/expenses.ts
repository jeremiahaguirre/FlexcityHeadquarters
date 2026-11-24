/**
 * Expense and mileage claims. Paid back on the next pay run as reimbursements
 * (not taxed, not insurable or pensionable): a reasonable per-kilometre
 * allowance and repayment of actual costs with receipts aren't income
 * (Income Tax Act s. 6(1)(b)(vii.1); CRA's reasonable per-km rates).
 *
 * Mileage is paid at the city's rate per kilometre, with a lower rate after a
 * yearly threshold, like CRA's two-tier rate. FH ships CRA's 2025 rates (72¢ for
 * the first 5,000 km, 66¢ after); the city updates them each January.
 */
import type { Tx } from '../../lib/db.js';
import { conflict } from '../../lib/errors.js';
import { addDays, startOfLocalDay } from '../../lib/time.js';
import type { PayrollSettings } from './payRuns.js';

export interface MileagePolicy { centsPerKm: number; centsAfter: number; tierKm: number; receiptOver: number }

export const mileagePolicy = (s: PayrollSettings): MileagePolicy => ({
  centsPerKm: s.mileage?.centsPerKm ?? 72,
  centsAfter: s.mileage?.centsAfter ?? 66,
  tierKm: s.mileage?.tierKm ?? 5000,
  receiptOver: s.mileage?.receiptOver ?? 25,
});

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Kilometres already claimed this year (submitted, approved or paid). */
export async function kmThisYear(tx: Tx, userId: string, year: number, excludeClaimId?: string): Promise<number> {
  const items = await tx.expenseItem.findMany({
    where: { category: 'MILEAGE', date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }, claim: { userId, status: { in: ['SUBMITTED', 'APPROVED', 'PAID'] }, ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}) } },
    select: { km: true },
  });
  return items.reduce((a, i) => a + Number(i.km ?? 0), 0);
}

/** The allowance for `km` more kilometres when `before` were already claimed this year. */
export function mileageAmount(before: number, km: number, p: MileagePolicy): { amount: number; centsPerKm: number } {
  const atFirst = Math.max(0, Math.min(km, p.tierKm - before));
  const atSecond = km - atFirst;
  const amount = r2((atFirst * p.centsPerKm + atSecond * p.centsAfter) / 100);
  return { amount, centsPerKm: km ? r2((amount * 100) / km) : p.centsPerKm };
}

/** A send that never finished (the process stopped) lets go of its claims after this long. */
export const SEND_HOLD_MS = 10 * 60_000;

/** Approved claims nobody holds: not on a pay run, not in a send in progress, not in a downloaded file. */
const freeClaim = (now: Date) => ({
  status: 'APPROVED' as const,
  payRunId: null,
  OR: [{ payrollSyncId: null }, { providerReservedAt: { lt: new Date(now.getTime() - SEND_HOLD_MS) } }],
});

/**
 * Approved expense claims to pay back through a payroll provider for a period (approved before the
 * period's last day ends, in the organization's time zone), held for the send or downloaded file
 * `syncId` so no other send or download can include them too. Claims already paid are never included
 * again (a resend after a correction carries the hours, not the reimbursements a provider accepted).
 * Call it inside the transaction that holds the organization's payroll-provider lock.
 */
export async function holdClaimsForProvider(tx: Tx, opts: { syncId: string; periodEnd: string; userIds?: Set<string> | null; download: boolean }) {
  const now = new Date();
  const facility = await tx.facility.findFirst({ orderBy: { name: 'asc' }, select: { timezone: true } });
  const cutoff = startOfLocalDay(addDays(opts.periodEnd, 1), facility?.timezone ?? 'America/Vancouver');
  const where = { ...freeClaim(now), decidedAt: { lt: cutoff }, ...(opts.userIds ? { userId: { in: [...opts.userIds] } } : {}) };
  const claims = await tx.expenseClaim.findMany({ where, select: { id: true, userId: true, total: true } });
  if (claims.length) {
    const { count } = await tx.expenseClaim.updateMany({ where: { ...where, id: { in: claims.map((c) => c.id) } }, data: { payrollSyncId: opts.syncId, providerReservedAt: opts.download ? null : now } });
    if (count !== claims.length) throw conflict('CLAIMS_BUSY', 'Another payroll send is using these expense claims. Try again in a minute.');
  }
  const byUser = new Map<string, { userId: string; amount: number; claimIds: string[] }>();
  for (const c of claims) {
    const row = byUser.get(c.userId) ?? { userId: c.userId, amount: 0, claimIds: [] };
    row.amount = r2(row.amount + Number(c.total));
    row.claimIds.push(c.id);
    byUser.set(c.userId, row);
  }
  return [...byUser.values()];
}

/** The send `syncId` finished: the claims it held are paid by it (accepted) or free again (refused). Returns how many. */
export async function settleHeldClaims(tx: Tx, syncId: string, accepted: boolean): Promise<number> {
  const { count } = await tx.expenseClaim.updateMany({
    where: { status: 'APPROVED', payrollSyncId: syncId },
    data: accepted ? { status: 'PAID', providerReservedAt: null } : { payrollSyncId: null, providerReservedAt: null },
  });
  return count;
}

/** Approved claims waiting to be paid, by person (for a pay run). */
export async function claimsToPay(tx: Tx, runId: string | undefined, payDate: string, userIds: string[] | null) {
  const claims = await tx.expenseClaim.findMany({
    // Not one held for (or paid through) a payroll provider's file.
    where: { status: 'APPROVED', payrollSyncId: null, OR: [{ payRunId: null }, ...(runId ? [{ payRunId: runId }] : [])], decidedAt: { lt: new Date(`${payDate}T23:59:59Z`) }, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { id: true, userId: true, title: true, total: true },
  });
  return claims.map((c) => ({ id: c.id, userId: c.userId, title: c.title, amount: Number(c.total) }));
}
