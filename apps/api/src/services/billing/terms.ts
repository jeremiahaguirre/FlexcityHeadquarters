/**
 * Billing terms: how often an organization is invoiced, and for how long it has committed.
 *
 * - Cycle: MONTHLY (each month), ANNUAL (twelve months in advance), or TERM (the whole term
 *   in advance, e.g. five years on one invoice).
 * - Term: month to month (no commitment), or a set number of months (12, 36, 60...). Prices are
 *   held for the term. After it ends, billing continues month to month at the same rates
 *   until the Dev console renews it.
 * - Discount: a commitment discount on fixed charges (plans, facilities, options, staff places),
 *   standard by term length, editable per organization. Usage (active staff beyond the plan) is
 *   never prepaid or discounted: it's billed each month for that month.
 */
import type { Line } from './pricing.js';

export type Cycle = 'MONTHLY' | 'ANNUAL' | 'TERM';
/** Lines that depend on the month's activity: billed monthly, never prepaid. */
export const USAGE_KINDS = new Set(['extra_staff', 'club_users']);

/** Standard commitment discount, in percent, by term length (months). Paying the whole term up front adds 2 points. */
export function standardDiscount(cycle: Cycle, termMonths: number | null): number {
  const months = termMonths ?? (cycle === 'ANNUAL' ? 12 : 0);
  const base = months >= 60 ? 12 : months >= 48 ? 10 : months >= 36 ? 8 : months >= 24 ? 6 : months >= 12 ? 4 : 0;
  return base + (cycle === 'TERM' && base ? 2 : 0);
}

export interface Terms {
  billingCycle: Cycle;
  termMonths: number | null;
  /** First day of the term (and of yearly invoices); null = not started (treated as month to month). */
  termStart: Date | null;
  /** Null = the standard for the term. */
  discountPercent: number | null;
}

const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

export function effectiveDiscount(t: Terms, month: Date): number {
  if (!t.termStart || !inTerm(t, month)) return 0;
  return t.discountPercent ?? standardDiscount(t.billingCycle, t.termMonths);
}

/** Within the committed term (a month-to-month account with yearly billing counts as always in term). */
export function inTerm(t: Terms, month: Date): boolean {
  if (!t.termStart) return false;
  const i = monthIndex(month) - monthIndex(t.termStart);
  if (i < 0) return false;
  return t.termMonths == null ? true : i < t.termMonths;
}

/**
 * What a month's invoice covers: `months` of fixed charges in advance (0 = none this month,
 * already prepaid; 1 = just this month), plus this month's usage.
 */
export function prepaidMonths(t: Terms, month: Date): number {
  if (!t.termStart || !inTerm(t, month) || t.billingCycle === 'MONTHLY') return 1;
  const i = monthIndex(month) - monthIndex(t.termStart);
  if (t.billingCycle === 'TERM') {
    if (t.termMonths == null) return 1; // no term to prepay: monthly
    return i === 0 ? t.termMonths : 0;
  }
  // ANNUAL: every twelve months, never past the end of the term.
  if (i % 12 !== 0) return 0;
  return t.termMonths == null ? 12 : Math.min(12, t.termMonths - i);
}

const pct = (cents: number, percent: number) => Math.round((cents * percent) / 100);

/**
 * Turns one month's lines into the month's invoice under the terms: fixed lines multiplied by the
 * months prepaid (or dropped when already prepaid), usage as is, and the commitment discount.
 */
export function invoiceLinesFor(monthly: Line[], t: Terms, month: Date, label: (key: string, vars?: Record<string, string | number>) => string): { lines: Line[]; prepaid: number; periodEnd: Date } {
  const months = prepaidMonths(t, month);
  const discount = effectiveDiscount(t, month);
  const lines: Line[] = [];
  for (const l of monthly) {
    if (USAGE_KINDS.has(l.kind)) {
      lines.push(l);
      continue;
    }
    if (!months) continue;
    lines.push(months === 1 ? l : { ...l, description: label('forMonths', { what: l.description, months }), quantity: l.quantity * months, amountCents: l.amountCents * months });
  }
  const fixed = lines.filter((l) => !USAGE_KINDS.has(l.kind) && l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  if (discount && fixed) {
    const off = -pct(fixed, discount);
    lines.push({ kind: 'term_discount', description: label('termDiscount', { percent: discount }), quantity: 1, unitCents: off, amountCents: off });
  }
  const periodEnd = new Date(addMonths(month, Math.max(1, months)).getTime() - 86_400_000);
  return { lines, prepaid: months, periodEnd };
}

/** The money view of the terms, for the Dev console and the organization's Billing page. */
export function termSummary(monthly: Line[], t: Terms, month: Date) {
  const fixed = monthly.filter((l) => !USAGE_KINDS.has(l.kind)).reduce((s, l) => s + l.amountCents, 0);
  const usage = monthly.filter((l) => USAGE_KINDS.has(l.kind)).reduce((s, l) => s + l.amountCents, 0);
  const discount = t.termStart ? (t.discountPercent ?? standardDiscount(t.billingCycle, t.termMonths)) : 0;
  const fixedAfter = fixed - pct(fixed, discount);
  const perInvoiceMonths = t.billingCycle === 'MONTHLY' || !t.termStart ? 1 : t.billingCycle === 'ANNUAL' ? 12 : t.termMonths ?? 1;
  const termEnd = t.termStart && t.termMonths ? new Date(addMonths(t.termStart, t.termMonths).getTime() - 86_400_000) : null;
  // When the next invoice with fixed charges is due, from this month.
  let next: Date | null = null;
  for (let k = 0; k < 72; k++) {
    const m = addMonths(month, k);
    if (prepaidMonths(t, m) > 0) {
      next = m;
      break;
    }
  }
  return {
    cycle: t.billingCycle,
    termMonths: t.termMonths,
    termStart: t.termStart ? t.termStart.toISOString().slice(0, 10) : null,
    termEnd: termEnd ? termEnd.toISOString().slice(0, 10) : null,
    discountPercent: discount,
    standardDiscountPercent: standardDiscount(t.billingCycle, t.termMonths),
    monthlyFixedCents: fixed,
    monthlyFixedAfterDiscountCents: fixedAfter,
    monthlyUsageCents: usage,
    perInvoiceFixedCents: fixedAfter * perInvoiceMonths,
    perInvoiceMonths,
    yearlyCents: fixedAfter * 12,
    contractCents: t.termMonths ? fixedAfter * t.termMonths : null,
    nextFixedInvoice: next ? next.toISOString().slice(0, 7) : null,
  };
}
