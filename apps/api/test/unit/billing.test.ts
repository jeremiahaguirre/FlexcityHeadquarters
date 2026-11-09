import { describe, expect, it } from 'vitest';
import { lineLabel, monthlyLines } from '../../src/services/billing/pricing.js';
import { SALES_TAX, taxFor } from '../../src/services/billing/tax.js';

const en = lineLabel('en-CA');

describe('subscription pricing', () => {
  it('municipal: per facility by tier, custom rates override, unbilled facilities skipped, add-ons on the subtotal', () => {
    const lines = monthlyLines(
      {
        plan: 'MUNICIPAL',
        facilities: [
          { name: 'Parkinson', tier: 2, customCents: null },
          { name: 'H2O Centre', tier: 3, customCents: 450_000 },
          { name: 'Works Yard', tier: null, customCents: null },
        ],
        activeUsers: 0,
        clubUserRateCents: 500,
        addOnHr: true,
        addOnOps: true,
      },
      en,
    );
    expect(lines.map((l) => [l.kind, l.amountCents])).toEqual([
      ['facility', 250_000],
      ['facility', 450_000],
      ['addon_hr', 140_000],
      ['addon_ops', 105_000],
    ]);
    expect(lines[1]!.description).toContain('contract rate');
  });

  it('club: base includes 20 active users, then the per-user rate', () => {
    const lines = monthlyLines({ plan: 'CLUB', facilities: [], activeUsers: 34, clubUserRateCents: 550, addOnHr: false, addOnOps: false }, en);
    expect(lines.map((l) => [l.kind, l.quantity, l.amountCents])).toEqual([
      ['club_base', 1, 9_900],
      ['club_users', 14, 7_700],
    ]);
    expect(monthlyLines({ plan: 'CLUB', facilities: [], activeUsers: 12, clubUserRateCents: 550, addOnHr: false, addOnOps: false }, en)).toHaveLength(1);
  });

  it('writes lines in French for French-speaking organizations', () => {
    const fr = monthlyLines({ plan: 'MUNICIPAL', facilities: [{ name: 'Centre', tier: 1, customCents: null }], activeUsers: 0, clubUserRateCents: 500, addOnHr: false, addOnOps: false }, lineLabel('fr-CA'));
    expect(fr[0]!.description).toBe('Licence d’installation, niveau 1 (petite / saisonnière) : Centre');
  });
});

describe('sales tax', () => {
  it('covers every province and territory', () => {
    expect(Object.keys(SALES_TAX).sort()).toEqual(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
  });
  it('applies GST plus PST/QST, or HST, rounding half-up per tax', () => {
    expect(taxFor('ON', 250_000, false)).toEqual([{ name: 'HST', rate: '13', amountCents: 32_500 }]);
    expect(taxFor('BC', 250_000, false).map((t) => t.amountCents)).toEqual([12_500, 17_500]);
    expect(taxFor('QC', 100_001, false)).toEqual([
      { name: 'GST', rate: '5', amountCents: 5_000 },
      { name: 'QST', rate: '9.975', amountCents: 9_975 },
    ]);
    expect(taxFor('NS', 10_000, false)[0]!.amountCents).toBe(1_400);
    expect(taxFor('AB', 250_000, true)).toEqual([]);
  });
});
