/**
 * Prices and what each plan includes, mirroring the app's plan catalogue
 * (apps/api/src/services/billing/catalog.ts). content.test.ts checks they match.
 * Dollars, monthly, before tax.
 */
export type Level = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const LEVELS: Level[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];
export type Module = 'core' | 'operations' | 'programs' | 'fleetWinter' | 'hrCompliance' | 'hrSuite' | 'benchmarks' | 'sso' | 'bankConnection' | 'union';

export const PUBLIC: Record<Level, { price: number; quoted: boolean; staff: number | null; extraStaff: number; modules: Module[] }> = {
  SMALL: { price: 1900, quoted: false, staff: 40, extraStaff: 8, modules: [] },
  BUSINESS: { price: 2800, quoted: false, staff: 75, extraStaff: 7, modules: ['operations', 'programs', 'fleetWinter'] },
  MULTI_COMPLEX: { price: 3600, quoted: true, staff: 150, extraStaff: 6, modules: ['operations', 'programs', 'fleetWinter', 'hrCompliance', 'hrSuite', 'benchmarks', 'sso', 'bankConnection'] },
  ENTERPRISE: { price: 4500, quoted: true, staff: null, extraStaff: 0, modules: ['operations', 'programs', 'fleetWinter', 'hrCompliance', 'hrSuite', 'benchmarks', 'sso', 'bankConnection', 'union'] },
};
/** Facility size scales the price and the staff allowance, in percent. */
export const SIZE = { seasonal: 40, standard: 100, major: 200 };
/** The union hub on a plan below Enterprise. */
export const UNION_EXTRA = 150;

export const PRIVATE = { core: 99, includedUsers: 20, perUser: 5 };
export const PRIVATE_MODULES: Record<Exclude<Module, 'core'>, number> = {
  operations: 79,
  programs: 99,
  fleetWinter: 39,
  hrCompliance: 89,
  hrSuite: 69,
  benchmarks: 29,
  sso: 49,
  bankConnection: 39,
  union: 150,
};

/** Whether a public plan includes a module. */
export const has = (level: Level, m: Module) => m === 'core' || PUBLIC[level].modules.includes(m);
