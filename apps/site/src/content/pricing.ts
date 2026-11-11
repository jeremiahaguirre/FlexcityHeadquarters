/**
 * Prices and what each plan includes, mirroring the app's plan catalogue
 * (apps/api/src/services/billing/catalog.ts). content.test.ts checks they match.
 * Dollars, monthly, before tax.
 */
export type Level = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const LEVELS: Level[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];
export type Group = 'operations' | 'programs' | 'fleetWinter' | 'hr' | 'integration' | 'union';
export const GROUPS: Group[] = ['operations', 'programs', 'fleetWinter', 'hr', 'integration', 'union'];
export type Item =
  | 'poolChemistry' | 'incidents' | 'statusBoard' | 'rotations' | 'registration' | 'fleet' | 'winter'
  | 'onboarding' | 'reliability' | 'discipline' | 'accommodation' | 'hrSuite' | 'benchmarks' | 'sso' | 'bankConnection' | 'publicApi' | 'union';

/** Each option: its group, the private-sector price, and the price to add it to a public plan without it. */
export const ITEMS: Record<Item, { group: Group; private: number; public: number }> = {
  poolChemistry: { group: 'operations', private: 39, public: 300 },
  incidents: { group: 'operations', private: 29, public: 250 },
  statusBoard: { group: 'operations', private: 19, public: 150 },
  rotations: { group: 'operations', private: 19, public: 150 },
  registration: { group: 'programs', private: 99, public: 600 },
  fleet: { group: 'fleetWinter', private: 29, public: 250 },
  winter: { group: 'fleetWinter', private: 19, public: 200 },
  onboarding: { group: 'hr', private: 39, public: 300 },
  reliability: { group: 'hr', private: 29, public: 250 },
  discipline: { group: 'hr', private: 29, public: 250 },
  accommodation: { group: 'hr', private: 19, public: 200 },
  hrSuite: { group: 'hr', private: 69, public: 500 },
  benchmarks: { group: 'hr', private: 29, public: 100 },
  sso: { group: 'integration', private: 49, public: 300 },
  bankConnection: { group: 'integration', private: 39, public: 300 },
  publicApi: { group: 'integration', private: 49, public: 300 },
  union: { group: 'union', private: 150, public: 150 },
};

const BUSINESS: Item[] = ['poolChemistry', 'incidents', 'statusBoard', 'rotations', 'registration', 'fleet', 'winter'];
const MULTI: Item[] = [...BUSINESS, 'onboarding', 'reliability', 'discipline', 'accommodation', 'hrSuite', 'benchmarks', 'sso', 'bankConnection', 'publicApi'];

export const PUBLIC: Record<Level, { price: number; quoted: boolean; staff: number | null; extraStaff: number; items: Item[] }> = {
  SMALL: { price: 1900, quoted: false, staff: 40, extraStaff: 8, items: [] },
  BUSINESS: { price: 2800, quoted: false, staff: 75, extraStaff: 7, items: BUSINESS },
  MULTI_COMPLEX: { price: 3600, quoted: true, staff: 150, extraStaff: 6, items: MULTI },
  ENTERPRISE: { price: 4500, quoted: true, staff: null, extraStaff: 0, items: [...MULTI, 'union'] },
};
/** Facility size scales the price and the staff allowance, in percent. */
export const SIZE = { seasonal: 40, standard: 100, major: 200 };

export const PRIVATE = { core: 99, includedUsers: 20, perUser: 5 };

/** Whether a public plan includes an option ('core' is in every plan). */
export const has = (level: Level, i: Item | 'core') => i === 'core' || PUBLIC[level].items.includes(i);

/** Commitment discounts on fixed charges, in percent, by term length in months (apps/api/src/services/billing/terms.ts). */
export const TERM_DISCOUNTS: Record<number, number> = { 12: 4, 24: 6, 36: 8, 48: 10, 60: 12 };
/** Paying the whole term up front adds this many points. */
export const UPFRONT_BONUS = 2;
/** Yearly billing is a one-year commitment. */
export const YEARLY_DISCOUNT = TERM_DISCOUNTS[12]!;
/** Monthly price when billed yearly, rounded to the dollar. */
export const yearlyMonthly = (monthly: number) => Math.round(monthly * (1 - YEARLY_DISCOUNT / 100));
