import { describe, expect, it } from 'vitest';
import { lineLabel } from '../../src/services/billing/pricing.js';
import { type Terms, invoiceLinesFor, prepaidMonths, standardDiscount, termSummary } from '../../src/services/billing/terms.js';

const en = lineLabel('en-CA');
const m = (iso: string) => new Date(`${iso}-01T00:00:00Z`);
const monthly = [
  { kind: 'facility', description: 'Business plan, facility: Centre', quantity: 1, unitCents: 280_000, amountCents: 280_000 },
  { kind: 'extra_staff', description: 'Active staff beyond the 75 included', quantity: 10, unitCents: 700, amountCents: 7_000 },
];
const terms = (t: Partial<Terms>): Terms => ({ billingCycle: 'MONTHLY', termMonths: null, termStart: null, discountPercent: null, ...t });

describe('billing terms', () => {
  it('standard discounts grow with the term; paying the whole term up front adds two points', () => {
    expect([null, 12, 24, 36, 60].map((n) => standardDiscount('MONTHLY', n))).toEqual([0, 4, 6, 8, 12]);
    expect(standardDiscount('ANNUAL', null)).toBe(4);
    expect(standardDiscount('TERM', 60)).toBe(14);
  });

  it('month to month: each month as it comes, no discount', () => {
    const r = invoiceLinesFor(monthly, terms({}), m('2026-11'), en);
    expect(r.lines.map((l) => l.amountCents)).toEqual([280_000, 7_000]);
  });

  it('a 5-year term billed monthly: the discount every month, usage never discounted', () => {
    const r = invoiceLinesFor(monthly, terms({ termMonths: 60, termStart: m('2026-01') }), m('2026-11'), en);
    expect(r.lines.map((l) => [l.kind, l.amountCents])).toEqual([['facility', 280_000], ['extra_staff', 7_000], ['term_discount', -33_600]]);
  });

  it('yearly: twelve months in advance on the anniversary, usage alone in between, and never past the term', () => {
    const t = terms({ billingCycle: 'ANNUAL', termMonths: 30, termStart: m('2026-01') });
    const jan = invoiceLinesFor(monthly, t, m('2026-01'), en);
    expect(jan.lines[0]).toMatchObject({ quantity: 12, amountCents: 3_360_000, description: 'Business plan, facility: Centre, 12 months' });
    expect(jan.periodEnd.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(invoiceLinesFor(monthly, t, m('2026-05'), en).lines.map((l) => l.kind)).toEqual(['extra_staff']);
    // The third year has six months left in the term.
    expect(prepaidMonths(t, m('2028-01'))).toBe(6);
    // After the term: month to month at the same rates, no discount.
    expect(invoiceLinesFor(monthly, t, m('2028-08'), en).lines.map((l) => l.kind)).toEqual(['facility', 'extra_staff']);
  });

  it('whole term up front: five years on the first invoice with its discount', () => {
    const t = terms({ billingCycle: 'TERM', termMonths: 60, termStart: m('2027-01') });
    const first = invoiceLinesFor(monthly, t, m('2027-01'), en);
    expect(first.lines.map((l) => [l.kind, l.amountCents])).toEqual([['facility', 16_800_000], ['extra_staff', 7_000], ['term_discount', -2_352_000]]);
    expect(first.periodEnd.toISOString().slice(0, 10)).toBe('2031-12-31');
    expect(prepaidMonths(t, m('2029-06'))).toBe(0);
  });

  it('a custom discount replaces the standard; the summary gives per invoice, yearly and contract value', () => {
    const t = terms({ billingCycle: 'ANNUAL', termMonths: 36, termStart: m('2026-01'), discountPercent: 10 });
    const s = termSummary(monthly, t, m('2026-03'));
    expect(s).toMatchObject({ discountPercent: 10, standardDiscountPercent: 8, monthlyFixedAfterDiscountCents: 252_000, perInvoiceFixedCents: 3_024_000, yearlyCents: 3_024_000, contractCents: 9_072_000, termEnd: '2028-12-31', nextFixedInvoice: '2027-01' });
  });
});
