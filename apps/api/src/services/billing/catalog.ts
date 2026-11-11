/**
 * FlexcityHeadquarters' plans: the one source for prices and what each plan includes.
 * The website (apps/site), the Dev console and the organization's Billing page all follow it
 * (a site test checks the prices match). docs/PRICING.md explains the reasoning.
 *
 * Everything beyond the core is sold as single options (ITEMS), each with its own price.
 *
 * Public sector: four plans, priced per facility per month.
 *   Small · Business · Multi-complex · Enterprise
 *   Each plan switches on its standard options. The Dev console can switch any option on or off
 *   for one organization: adding one bills its price, removing a standard one credits it. Every
 *   option's price can be set per organization; the standard price is the default.
 *   A facility's size scales its price and its staff allowance: seasonal ×0.4, standard ×1,
 *   major complex ×2. Each plan includes active staff per facility (pooled across the
 *   organization); each active person beyond that is billed monthly. Enterprise: unlimited.
 *   "Active" = had a published shift or a punch in the month; seasonal staff away cost nothing.
 *   Multi-complex and Enterprise show a list price; the Dev console records the quoted rate.
 * Private sector: a core plan with 20 active users included, then per active user, plus the
 * options chosen one by one, each at its own monthly price.
 *
 * Never behind a paywall: safety and legal duties (working alone, injury reports, rest and
 * overtime rules, young-worker limits), payroll, security (passkeys, multi-factor sign-in) and
 * privacy rights (records export, audit log, retention settings, the privacy notice).
 */
import type { FeatureKey } from '../platform/features.js';

/** How options are grouped on screens. */
export const GROUPS = ['operations', 'programs', 'fleetWinter', 'hr', 'integration', 'union'] as const;
export type Group = (typeof GROUPS)[number];

export interface Item {
  group: Group;
  /** Feature switches the option unlocks. Empty: checked where it's configured (SSO, bank). */
  features: readonly FeatureKey[];
  /** Standard monthly price for a private-sector organization, in cents. */
  privateCents: number;
  /** Standard monthly price per organization in the public sector: added to a plan without it, credited when removed. */
  publicCents: number;
}

export const ITEMS = {
  poolChemistry: { group: 'operations', features: ['poolChemistry'], privateCents: 3_900, publicCents: 30_000 },
  incidents: { group: 'operations', features: ['incidents'], privateCents: 2_900, publicCents: 25_000 },
  statusBoard: { group: 'operations', features: ['statusBoard'], privateCents: 1_900, publicCents: 15_000 },
  rotations: { group: 'operations', features: ['rotations'], privateCents: 1_900, publicCents: 15_000 },
  registration: { group: 'programs', features: ['registration'], privateCents: 9_900, publicCents: 60_000 },
  fleet: { group: 'fleetWinter', features: ['fleet'], privateCents: 2_900, publicCents: 25_000 },
  winter: { group: 'fleetWinter', features: ['callOuts', 'patrols'], privateCents: 1_900, publicCents: 20_000 },
  onboarding: { group: 'hr', features: ['onboarding'], privateCents: 3_900, publicCents: 30_000 },
  reliability: { group: 'hr', features: ['reliability'], privateCents: 2_900, publicCents: 25_000 },
  discipline: { group: 'hr', features: ['discipline'], privateCents: 2_900, publicCents: 25_000 },
  accommodation: { group: 'hr', features: ['accommodation'], privateCents: 1_900, publicCents: 20_000 },
  hrSuite: { group: 'hr', features: ['hrSuite'], privateCents: 6_900, publicCents: 50_000 },
  benchmarks: { group: 'hr', features: ['benchmarks'], privateCents: 2_900, publicCents: 10_000 },
  sso: { group: 'integration', features: [], privateCents: 4_900, publicCents: 30_000 },
  bankConnection: { group: 'integration', features: [], privateCents: 3_900, publicCents: 30_000 },
  /** API keys and webhooks for the organization's own systems (docs/PUBLIC-API.md). */
  publicApi: { group: 'integration', features: [], privateCents: 4_900, publicCents: 30_000 },
  union: { group: 'union', features: ['union'], privateCents: 15_000, publicCents: 15_000 },
} as const satisfies Record<string, Item>;
export type ItemKey = keyof typeof ITEMS;
export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];
/** Kept for callers that think in "modules": a module is one option. */
export type Module = ItemKey;

export type PlanLevel = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const PLAN_LEVELS: PlanLevel[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];

export interface PublicPlan {
  /** List price per standard facility per month, in cents. */
  listCents: number;
  /** Priced after a quote: the list price is a starting point, the Dev console sets the rate. */
  quoted: boolean;
  /** Active staff included per standard facility (pooled); null = unlimited. */
  staffPerFacility: number | null;
  /** Each active person beyond the allowance, per month, in cents. */
  extraStaffCents: number;
  /** Options switched on by the plan. */
  items: readonly ItemKey[];
  /** Service that comes with the plan (not software switches). */
  service: readonly ('support' | 'prioritySupport' | 'successManager' | 'sla' | 'sandbox' | 'priceLock')[];
}

const BUSINESS_ITEMS = ['poolChemistry', 'incidents', 'statusBoard', 'rotations', 'registration', 'fleet', 'winter'] as const;
const MULTI_ITEMS = [...BUSINESS_ITEMS, 'onboarding', 'reliability', 'discipline', 'accommodation', 'hrSuite', 'benchmarks', 'sso', 'bankConnection', 'publicApi'] as const;

export const PUBLIC_PLANS: Record<PlanLevel, PublicPlan> = {
  SMALL: { listCents: 190_000, quoted: false, staffPerFacility: 40, extraStaffCents: 800, items: [], service: ['support'] },
  BUSINESS: { listCents: 280_000, quoted: false, staffPerFacility: 75, extraStaffCents: 700, items: BUSINESS_ITEMS, service: ['support'] },
  MULTI_COMPLEX: { listCents: 360_000, quoted: true, staffPerFacility: 150, extraStaffCents: 600, items: MULTI_ITEMS, service: ['prioritySupport'] },
  ENTERPRISE: { listCents: 450_000, quoted: true, staffPerFacility: null, extraStaffCents: 0, items: [...MULTI_ITEMS, 'union'], service: ['prioritySupport', 'successManager', 'sla', 'sandbox', 'priceLock'] },
};

/** Facility size (stored as Facility.billingTier): seasonal or outdoor, standard, major complex. */
export const SIZE_PERCENT: Record<number, number> = { 1: 40, 2: 100, 3: 200 };

/** Private sector. */
export const PRIVATE_CORE_CENTS = 9_900;
export const PRIVATE_INCLUDED_USERS = 20;
export const PRIVATE_USER_CENTS = 500;

/** One-time setup. */
export const SETUP_CENTS = { private: [150_000, 300_000], publicSmall: [500_000, 800_000], publicLarge: [800_000, 1_500_000] } as const;

/** Per-organization choices: an option switched away from the plan's standard, and/or its own price. */
export type ItemChoice = { on?: boolean; cents?: number | null };
export type ItemChoices = Partial<Record<ItemKey, ItemChoice>>;

export interface Entitlement {
  plan: 'MUNICIPAL' | 'CLUB';
  level: PlanLevel;
  /** Stored as JSON: { [option]: { on?, cents? } }. Anything unknown is ignored. */
  items: unknown;
}

export function readChoices(raw: unknown): ItemChoices {
  const out: ItemChoices = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ITEM_KEYS as string[]).includes(k) || !v || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    out[k as ItemKey] = { ...(typeof c.on === 'boolean' ? { on: c.on } : {}), ...(Number.isInteger(c.cents) && (c.cents as number) >= 0 ? { cents: c.cents as number } : {}) };
  }
  return out;
}

/** Options the plan switches on by itself. */
export const standardItems = (plan: Entitlement['plan'], level: PlanLevel): readonly ItemKey[] => (plan === 'CLUB' ? [] : PUBLIC_PLANS[level].items);

/** The standard price of an option for this kind of organization. */
export const standardCents = (plan: Entitlement['plan'], item: ItemKey) => (plan === 'CLUB' ? ITEMS[item].privateCents : ITEMS[item].publicCents);

/** Every option: on or off for this organization, standard or not, and its price. */
export function itemStates(e: Entitlement) {
  const choices = readChoices(e.items);
  const std = standardItems(e.plan, e.level);
  return ITEM_KEYS.map((key) => {
    const standard = std.includes(key);
    const c = choices[key] ?? {};
    return { key, standard, on: c.on ?? standard, cents: c.cents ?? standardCents(e.plan, key), customPrice: c.cents != null };
  });
}

/** The options an account has. */
export function ownedItems(e: Entitlement): Set<ItemKey> {
  return new Set(itemStates(e).filter((s) => s.on).map((s) => s.key));
}
export const ownedModules = ownedItems;

/** Features the account's plan doesn't include → the option that unlocks them. */
export function lockedFeatures(e: Entitlement): Partial<Record<FeatureKey, ItemKey>> {
  const owned = ownedItems(e);
  const out: Partial<Record<FeatureKey, ItemKey>> = {};
  for (const k of ITEM_KEYS) if (!owned.has(k)) for (const f of ITEMS[k].features) out[f] = k;
  return out;
}

/** Everything the website and the Dev console need to show the plans. */
export function catalog() {
  return {
    groups: GROUPS,
    items: ITEMS,
    public: PUBLIC_PLANS,
    sizePercent: SIZE_PERCENT,
    private: { coreCents: PRIVATE_CORE_CENTS, includedUsers: PRIVATE_INCLUDED_USERS, userCents: PRIVATE_USER_CENTS },
    setup: SETUP_CENTS,
  };
}
