import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createI18n } from './i18n';
import { type TermView, renewalLines } from './renewalTerms';

const fmt = (lng: string) => ({
  money: (c: number) => new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD' }).format(c / 100),
  date: (d: string) => d,
});
const term3y: TermView = { cycle: 'ANNUAL', termMonths: 36, termEnd: '2027-12-31', discountPercent: 8, monthlyFixedCents: 100_000, monthlyFixedAfterDiscountCents: 92_000, perInvoiceFixedCents: 1_104_000, perInvoiceMonths: 12 };
const monthly: TermView = { cycle: 'MONTHLY', termMonths: null, termEnd: null, discountPercent: 0, monthlyFixedCents: 50_000, monthlyFixedAfterDiscountCents: 50_000, perInvoiceFixedCents: 50_000, perInvoiceMonths: 1 };

describe('renewal terms beside the billing buttons', () => {
  it.each([
    ['en-CA', ['before tax', 'Invoiced every 12 months', 'Term: 3 years, ending 2027-12-31', 'renews automatically', 'without the commitment discount', 'write to billing@x.ca before 2027-12-31', '30 days', 'Refunds']],
    ['fr-CA', ['avant taxes', 'Facturé tous les 12 mois', 'Durée : 3 ans, jusqu’au 2027-12-31', 'renouvelle automatiquement', 'sans le rabais d’engagement', 'écrivez à billing@x.ca avant le 2027-12-31', '30 jours', 'Remboursements']],
  ] as const)('%s: price and tax, frequency, term, automatic renewal and its price, how and by when to cancel, notice', (lng, want) => {
    const { t } = createI18n(lng);
    const all = renewalLines(term3y, { t, ...fmt(lng), contact: 'billing@x.ca' }).join(' ');
    for (const w of want) expect(all).toContain(w);
    // The renewal price is the undiscounted one; the current price is after the discount.
    expect(all).toContain(fmt(lng).money(100_000));
    expect(all).toContain(fmt(lng).money(92_000));
    expect(all).not.toMatch(/\{\{|renewal\./);
  });

  it.each(['en-CA', 'fr-CA'] as const)('%s: month to month and no terms on file', (lng) => {
    const { t } = createI18n(lng);
    const m = renewalLines(monthly, { t, ...fmt(lng), contact: 'b@x.ca' }).join(' ');
    expect(m).toMatch(lng === 'en-CA' ? /month to month.*renews automatically each month.*before the next month starts/s : /au mois.*renouvelle automatiquement chaque mois.*avant le début du mois suivant/s);
    expect(renewalLines(null, { t, ...fmt(lng) }).join(' ')).toMatch(lng === 'en-CA' ? /order form/ : /bon de commande/);
  });

  it('every pay, bank-debit and plan button on the Billing page sits beside the terms', () => {
    const page = readFileSync(join(__dirname, '../app/(app)/manage/billing/page.tsx'), 'utf8');
    for (const m of page.matchAll(/<Button[^>]*onClick=\{\(\) => void pay\(/g)) expect(m[0]).toContain('aria-describedby="renewal-pay"');
    expect(page.match(/void pay\(/g)?.length).toBe(2);
    expect(page).toContain('id="renewal-pay"');
    expect(page).toContain('id="renewal-plan"');
    expect(page).toContain('renewal={<RenewalTerms');
    const pad = readFileSync(join(__dirname, '../components/billing/AutoDebitCard.tsx'), 'utf8');
    expect(pad.match(/\{renewal\}/g)?.length).toBe(2);
    // The Dev console previews what the organization will see.
    expect(readFileSync(join(__dirname, '../components/platform/BillingPanel.tsx'), 'utf8')).toContain("title={t('renewal.consoleTitle')}");
  });
});
