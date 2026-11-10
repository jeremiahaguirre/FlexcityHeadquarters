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

/** Approved claims waiting to be paid, by person (for a pay run). */
export async function claimsToPay(tx: Tx, runId: string | undefined, payDate: string, userIds: string[] | null) {
  const claims = await tx.expenseClaim.findMany({
    where: { status: 'APPROVED', OR: [{ payRunId: null }, ...(runId ? [{ payRunId: runId }] : [])], decidedAt: { lt: new Date(`${payDate}T23:59:59Z`) }, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { id: true, userId: true, title: true, total: true },
  });
  return claims.map((c) => ({ id: c.id, userId: c.userId, title: c.title, amount: Number(c.total) }));
}
