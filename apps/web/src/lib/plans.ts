/** The plan catalogue as the API sends it (apps/api/src/services/billing/catalog.ts). */
export type PlanLevel = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const PLAN_LEVELS: PlanLevel[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];
export const GROUPS = ['operations', 'programs', 'fleetWinter', 'hr', 'integration', 'union'] as const;
export type Group = (typeof GROUPS)[number];
export type ItemKey =
  | 'poolChemistry' | 'incidents' | 'statusBoard' | 'rotations' | 'registration' | 'fleet' | 'winter'
  | 'onboarding' | 'reliability' | 'discipline' | 'accommodation' | 'hrSuite' | 'benchmarks' | 'sso' | 'bankConnection' | 'union';
/** Kept for screens that say "module": each option is one. */
export type Module = ItemKey;

export interface PublicPlan { listCents: number; quoted: boolean; staffPerFacility: number | null; extraStaffCents: number; items: ItemKey[]; service: string[] }
export interface Catalog {
  groups: Group[];
  items: Record<ItemKey, { group: Group; features: string[]; privateCents: number; publicCents: number }>;
  public: Record<PlanLevel, PublicPlan>;
  sizePercent: Record<string, number>;
  private: { coreCents: number; includedUsers: number; userCents: number };
}
/** One option for one organization, as stored. */
export interface ItemState { key: ItemKey; standard: boolean; on: boolean; cents: number; customPrice: boolean }

export const cents = (c: number, lng: string, whole = true) =>
  new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD', maximumFractionDigits: whole && c % 100 === 0 ? 0 : 2 }).format(c / 100);
