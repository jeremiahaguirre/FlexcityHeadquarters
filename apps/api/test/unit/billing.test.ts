import { describe, expect, it } from 'vitest';
import { lineLabel, monthlyLines, staffUsage } from '../../src/services/billing/pricing.js';
import { ITEMS, PLAN_LEVELS, PUBLIC_PLANS, lockedFeatures } from '../../src/services/billing/catalog.js';
import { SALES_TAX, taxFor } from '../../src/services/billing/tax.js';

const en = lineLabel('en-CA');

const base = { facilities: [], activeUsers: 0, clubUserRateCents: 500, quotedRateCents: null, items: {} as object };

describe('subscription pricing', () => {
  it('public sector: the plan rate per facility, scaled by size; contract rates win; unbilled facilities skipped', () => {
    const lines = monthlyLines(
      {
        ...base,
        plan: 'MUNICIPAL',
        level: 'BUSINESS',
        facilities: [
          { name: 'Parkinson', tier: 2, customCents: null },
          { name: 'Splash pad', tier: 1, customCents: null },
          { name: 'H2O Centre', tier: 3, customCents: null },
          { name: 'Arena', tier: 2, customCents: 200_000 },
          { name: 'Works Yard', tier: null, customCents: null },
        ],
      },
      en,
    );
    expect(lines.map((l) => [l.kind, l.amountCents])).toEqual([
      ['facility', 280_000],
      ['facility', 112_000],
      ['facility', 560_000],
      ['facility', 200_000],
    ]);
    expect(lines[0]!.description).toBe('Business plan, facility: Parkinson');
    expect(lines[3]!.description).toContain('contract rate');
  });

  it('a quoted rate applies only to Multi-complex and Enterprise', () => {
    const one = [{ name: 'Centre', tier: 2, customCents: null }];
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'ENTERPRISE', quotedRateCents: 410_000, facilities: one }, en)[0]!.amountCents).toBe(410_000);
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'MULTI_COMPLEX', facilities: one }, en)[0]!.amountCents).toBe(PUBLIC_PLANS.MULTI_COMPLEX.listCents);
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'SMALL', quotedRateCents: 1, facilities: one }, en)[0]!.amountCents).toBe(PUBLIC_PLANS.SMALL.listCents);
  });

  it('staff beyond the plan’s allowance are billed per person; Enterprise is unlimited', () => {
    const two = [{ name: 'Centre', tier: 2, customCents: null }, { name: 'Pool', tier: 1, customCents: null }];
    // Business: 75 per standard facility, 30 for a seasonal one = 105 included.
    const lines = monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'BUSINESS', facilities: two, activeUsers: 120 }, en);
    expect(lines.at(-1)).toMatchObject({ kind: 'extra_staff', quantity: 15, unitCents: 700, amountCents: 10_500 });
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'BUSINESS', facilities: two, activeUsers: 105 }, en).map((l) => l.kind)).not.toContain('extra_staff');
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'ENTERPRISE', facilities: two, activeUsers: 5000 }, en).map((l) => l.kind)).not.toContain('extra_staff');
    // Multi-complex: a quoted allowance replaces the per-facility one.
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'MULTI_COMPLEX', includedStaff: 400, facilities: two, activeUsers: 410 }, en).at(-1)).toMatchObject({ quantity: 10, unitCents: 600 });
  });

  it('staff places added to the plan are billed every month and raise the allowance; only the rest is overage', () => {
    const one = [{ name: 'Centre', tier: 2, customCents: null }];
    const lines = monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'SMALL', facilities: one, activeUsers: 70, extraStaffSeats: 25 }, en);
    expect(lines.slice(1).map((l) => [l.kind, l.quantity, l.amountCents])).toEqual([['staff_seats', 25, 20_000], ['extra_staff', 5, 4_000]]);
    expect(staffUsage({ ...base, plan: 'MUNICIPAL', level: 'SMALL', facilities: one, activeUsers: 70, extraStaffSeats: 25 })).toMatchObject({ included: 40, seats: 25, over: 5, rateCents: 800 });
    const club = monthlyLines({ ...base, plan: 'CLUB', level: 'BUSINESS', activeUsers: 30, clubUserRateCents: 500, extraStaffSeats: 10 }, en);
    expect(club.map((l) => l.kind)).toEqual(['club_base', 'staff_seats']);
  });

  it('any option can be switched on or off: added ones billed, removed standard ones credited, at a custom price if set', () => {
    const one = [{ name: 'Centre', tier: 2, customCents: null }];
    const lines = monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'BUSINESS', facilities: one, items: { discipline: { on: true, cents: 12_000 }, rotations: { on: false }, fleet: { on: false, cents: 5_000 }, incidents: { cents: 1 } } }, en);
    expect(lines.map((l) => [l.kind, l.amountCents])).toEqual([
      ['facility', 280_000],
      ['credit_rotations', -ITEMS.rotations.publicCents],
      ['credit_fleet', -5_000],
      ['item_discipline', 12_000],
    ]);
    expect(lines[1]!.description).toBe('Removed from the plan: Deck rotation');
    expect(lines[3]!.description).toBe('Added to the plan: Discipline records');
  });

  it('the union hub is an extra below Enterprise and included in it', () => {
    const one = [{ name: 'Centre', tier: 2, customCents: null }];
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'BUSINESS', items: { union: { on: true } }, facilities: one }, en).map((l) => [l.kind, l.amountCents])).toEqual([['facility', 280_000], ['item_union', ITEMS.union.publicCents]]);
    expect(monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'ENTERPRISE', items: { union: { on: true } }, facilities: one }, en).map((l) => l.kind)).toEqual(['facility']);
  });

  it('private sector: core with 20 active users, then per user, then each option at its own price', () => {
    const lines = monthlyLines({ ...base, plan: 'CLUB', level: 'BUSINESS', activeUsers: 34, clubUserRateCents: 550, items: { poolChemistry: { on: true }, discipline: { on: true, cents: 1_500 } } }, en);
    expect(lines.map((l) => [l.kind, l.quantity, l.amountCents])).toEqual([
      ['club_base', 1, 9_900],
      ['club_users', 14, 7_700],
      ['item_poolChemistry', 1, ITEMS.poolChemistry.privateCents],
      ['item_discipline', 1, 1_500],
    ]);
    expect(monthlyLines({ ...base, plan: 'CLUB', level: 'BUSINESS', activeUsers: 12 }, en)).toHaveLength(1);
  });

  it('writes lines in French for French-speaking organizations', () => {
    const fr = monthlyLines({ ...base, plan: 'MUNICIPAL', level: 'SMALL', facilities: [{ name: 'Centre', tier: 1, customCents: null }] }, lineLabel('fr-CA'));
    expect(fr[0]!.description).toBe('Forfait Petit, installation saisonnière ou extérieure : Centre');
  });
});

describe('what each plan unlocks', () => {
  const locked = (e: Parameters<typeof lockedFeatures>[0]) => Object.keys(lockedFeatures(e)).sort();
  it('Small has the core; each level adds to the one below; Enterprise has everything', () => {
    expect(locked({ plan: 'MUNICIPAL', level: 'SMALL', items: {} })).toContain('poolChemistry');
    expect(locked({ plan: 'MUNICIPAL', level: 'BUSINESS', items: {} })).not.toContain('poolChemistry');
    expect(locked({ plan: 'MUNICIPAL', level: 'BUSINESS', items: {} })).toContain('discipline');
    expect(locked({ plan: 'MUNICIPAL', level: 'MULTI_COMPLEX', items: {} })).toEqual(['union']);
    expect(locked({ plan: 'MUNICIPAL', level: 'ENTERPRISE', items: {} })).toEqual([]);
    for (let i = 1; i < PLAN_LEVELS.length; i++) for (const m of PUBLIC_PLANS[PLAN_LEVELS[i - 1]!].items) expect(PUBLIC_PLANS[PLAN_LEVELS[i]!].items).toContain(m);
  });
  it('safety, legal duties and privacy are never locked', () => {
    for (const f of ['loneWork', 'injuryClaims', 'timeclock', 'payroll', 'overtime', 'care', 'coverage'] as const) expect(locked({ plan: 'CLUB', level: 'SMALL', items: {} })).not.toContain(f);
  });
  it('private sector: only the options chosen; the Dev console can lock a standard one', () => {
    expect(locked({ plan: 'MUNICIPAL', level: 'BUSINESS', items: { incidents: { on: false } } })).toContain('incidents');
    const l = locked({ plan: 'CLUB', level: 'BUSINESS', items: { registration: { on: true } } });
    expect(l).not.toContain('registration');
    expect(l).toContain('poolChemistry');
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
