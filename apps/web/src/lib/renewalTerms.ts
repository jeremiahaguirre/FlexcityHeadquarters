/**
 * Plain-language price and renewal terms, shown beside every subscribe, pay and debit button on the
 * organization's Billing page, and previewed in the Dev console where FH sets the terms. Matches what
 * billing actually does (apps/api/src/services/billing/terms.ts and renewal.ts):
 * - fixed charges are held for the term, with the commitment discount; usage is billed monthly;
 * - a term renews automatically month to month at the same rates, without the commitment discount;
 * - cancelling stops invoicing after the period already billed (no partial-period refunds);
 * - a reminder goes to the billing contact 30 days before a term ends.
 */
import type { TFunction } from 'i18next';

export interface TermView {
  cycle: 'MONTHLY' | 'ANNUAL' | 'TERM';
  termMonths: number | null;
  termEnd: string | null;
  discountPercent: number;
  /** Fixed charges a month, before and after the commitment discount, before tax. */
  monthlyFixedCents?: number;
  monthlyFixedAfterDiscountCents?: number;
  perInvoiceFixedCents: number;
  perInvoiceMonths: number;
}

export const RENEWAL_NOTICE_DAYS = 30;

export function renewalLines(term: TermView | null, opts: { t: TFunction; money: (cents: number) => string; date: (iso: string) => string; contact?: string | null }): string[] {
  const { t, money, date } = opts;
  const contact = opts.contact || t('renewal.ourBilling');
  if (!term) return [t('renewal.none', { contact }), t('renewal.refund')];
  const full = term.monthlyFixedCents ?? term.monthlyFixedAfterDiscountCents ?? 0;
  const after = term.monthlyFixedAfterDiscountCents ?? full;
  const lines: string[] = [];
  lines.push(term.discountPercent > 0 ? t('renewal.priceDiscount', { amount: money(after), percent: term.discountPercent }) : t('renewal.price', { amount: money(after) }));
  lines.push(t(`renewal.frequency.${term.cycle}`, { amount: money(term.perInvoiceFixedCents), count: term.perInvoiceMonths }));
  if (term.termMonths && term.termEnd) {
    const length = term.termMonths % 12 === 0 ? t('billing.years', { count: term.termMonths / 12 }) : t('renewal.months', { count: term.termMonths });
    lines.push(t('renewal.term', { length, end: date(term.termEnd) }));
    lines.push(t('renewal.renewsTerm', { amount: money(full) }));
    lines.push(t('renewal.cancelTerm', { contact, end: date(term.termEnd) }));
    lines.push(t('renewal.notice', { days: RENEWAL_NOTICE_DAYS }));
  } else {
    lines.push(t('renewal.monthToMonth'));
    lines.push(t('renewal.renewsMonthly'));
    lines.push(t('renewal.cancelMonthly', { contact }));
  }
  lines.push(t('renewal.refund'));
  return lines;
}
