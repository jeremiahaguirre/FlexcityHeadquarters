/**
 * FlexcityHeadquarters' plans: the one source for prices and what each plan includes.
 * The website (apps/site), the Dev console and the organization's Billing page all follow it
 * (a site test checks the prices match). docs/PRICING.md explains the reasoning.
 *
 * Public sector: four plans, priced per facility per month.
 *   Small · Business · Multi-complex · Enterprise
 *   A facility's size scales its price and its staff allowance: seasonal ×0.4, standard ×1,
 *   major complex ×2. Each plan includes active staff per facility (pooled across the
 *   organization); each active person beyond that is billed monthly. Enterprise: unlimited.
 *   "Active" = had a published shift or a punch in the month; seasonal staff away cost nothing.
 *   Multi-complex and Enterprise show a list price; the Dev console records the quoted rate.
 * Private sector: a core plan with 20 active users included, then per active user, plus
 * modules chosen one by one, each with its own monthly price.
 *
 * Never behind a paywall: safety and legal duties (working alone, injury reports, rest and
 * overtime rules, young-worker limits), security (passkeys, multi-factor sign-in) and privacy
 * rights (records export, audit log, retention settings, the privacy notice).
 */
import type { FeatureKey } from '../platform/features.js';

/** Sellable groups of features. Each feature belongs to at most one module; the rest is core. */
export const MODULES = {
  operations: ['poolChemistry', 'incidents', 'statusBoard', 'rotations'],
  programs: ['registration'],
  fleetWinter: ['fleet', 'callOuts', 'patrols'],
  hrCompliance: ['onboarding', 'reliability', 'discipline', 'accommodation'],
  hrSuite: ['hrSuite'],
  benchmarks: ['benchmarks'],
  /** Not feature switches: checked where they're configured (SSO settings, the bank connection). */
  sso: [],
  bankConnection: [],
  union: ['union'],
} as const satisfies Record<string, readonly FeatureKey[]>;
export type Module = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as Module[];

export type PlanLevel = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const PLAN_LEVELS: PlanLevel[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];

export interface PublicPlan {
  /** List price per standard facility per month, in cents. */
  listCents: number;
  /** Priced after a quote: the list price is a starting point, the Dev console sets the rate. */
  quoted: boolean;
  modules: readonly Module[];
  /** Active staff included per standard facility (pooled); null = unlimited. */
  staffPerFacility: number | null;
  /** Each active person beyond the allowance, per month, in cents. */
  extraStaffCents: number;
  /** Service that comes with the plan (not software switches). */
  service: readonly ('support' | 'prioritySupport' | 'successManager' | 'sla' | 'sandbox' | 'priceLock')[];
}

const BUSINESS_MODULES = ['operations', 'programs', 'fleetWinter'] as const;
const MULTI_MODULES = [...BUSINESS_MODULES, 'hrCompliance', 'hrSuite', 'benchmarks', 'sso', 'bankConnection'] as const;

export const PUBLIC_PLANS: Record<PlanLevel, PublicPlan> = {
  SMALL: { listCents: 190_000, quoted: false, staffPerFacility: 40, extraStaffCents: 800, modules: [], service: ['support'] },
  BUSINESS: { listCents: 280_000, quoted: false, staffPerFacility: 75, extraStaffCents: 700, modules: BUSINESS_MODULES, service: ['support'] },
  MULTI_COMPLEX: { listCents: 360_000, quoted: true, staffPerFacility: 150, extraStaffCents: 600, modules: MULTI_MODULES, service: ['prioritySupport'] },
  ENTERPRISE: { listCents: 450_000, quoted: true, staffPerFacility: null, extraStaffCents: 0, modules: [...MULTI_MODULES, 'union'], service: ['prioritySupport', 'successManager', 'sla', 'sandbox', 'priceLock'] },
};

/** Facility size (stored as Facility.billingTier): seasonal or outdoor, standard, major complex. */
export const SIZE_PERCENT: Record<number, number> = { 1: 40, 2: 100, 3: 200 };

/** Extras a public-sector plan can add when it doesn't include them. */
export const PUBLIC_EXTRAS: Partial<Record<Module, number>> = { union: 15_000 };

/** Private sector. */
export const PRIVATE_CORE_CENTS = 9_900;
export const PRIVATE_INCLUDED_USERS = 20;
export const PRIVATE_USER_CENTS = 500;
/** Each module's monthly price for private employers. */
export const PRIVATE_MODULE_CENTS: Record<Module, number> = {
  operations: 7_900,
  programs: 9_900,
  fleetWinter: 3_900,
  hrCompliance: 8_900,
  hrSuite: 6_900,
  benchmarks: 2_900,
  sso: 4_900,
  bankConnection: 3_900,
  union: 15_000,
};

/** One-time setup. */
export const SETUP_CENTS = { private: [150_000, 300_000], publicSmall: [500_000, 800_000], publicLarge: [800_000, 1_500_000] } as const;

export interface Entitlement {
  plan: 'MUNICIPAL' | 'CLUB';
  level: PlanLevel;
  /** Extras bought on top of the plan (public) or the chosen modules (private). */
  modules: readonly string[];
}

/** The modules an account has. */
export function ownedModules(e: Entitlement): Set<Module> {
  const extra = e.modules.filter((m): m is Module => (MODULE_KEYS as string[]).includes(m));
  if (e.plan === 'CLUB') return new Set(extra);
  return new Set<Module>([...PUBLIC_PLANS[e.level].modules, ...extra.filter((m) => m in PUBLIC_EXTRAS)]);
}

/** Features the account's plan doesn't include → the module that unlocks them. */
export function lockedFeatures(e: Entitlement): Partial<Record<FeatureKey, Module>> {
  const owned = ownedModules(e);
  const out: Partial<Record<FeatureKey, Module>> = {};
  for (const m of MODULE_KEYS) if (!owned.has(m)) for (const f of MODULES[m]) out[f] = m;
  return out;
}

/** Everything the website and the Dev console need to show the plans. */
export function catalog() {
  return {
    modules: Object.fromEntries(MODULE_KEYS.map((m) => [m, { features: MODULES[m], privateCents: PRIVATE_MODULE_CENTS[m] }])),
    public: Object.fromEntries(PLAN_LEVELS.map((l) => [l, PUBLIC_PLANS[l]])),
    sizePercent: SIZE_PERCENT,
    publicExtras: PUBLIC_EXTRAS,
    private: { coreCents: PRIVATE_CORE_CENTS, includedUsers: PRIVATE_INCLUDED_USERS, userCents: PRIVATE_USER_CENTS },
    setup: SETUP_CENTS,
  };
}
