/** The plan catalogue as the API sends it (apps/api/src/services/billing/catalog.ts). */
export type PlanLevel = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const PLAN_LEVELS: PlanLevel[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];
export const GROUPS = ['operations', 'programs', 'fleetWinter', 'hr', 'integration', 'union'] as const;
export type Group = (typeof GROUPS)[number];
export type ItemKey =
  | 'poolChemistry' | 'incidents' | 'statusBoard' | 'rotations' | 'registration' | 'fleet' | 'winter'
  | 'onboarding' | 'reliability' | 'discipline' | 'accommodation' | 'hrSuite' | 'benchmarks' | 'sso' | 'bankConnection' | 'publicApi' | 'union';

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

export type Cycle = 'MONTHLY' | 'ANNUAL' | 'TERM';
/** Term lengths offered in the Dev console, in months (any length up to 120 can be typed). */
export const TERM_CHOICES = [12, 24, 36, 48, 60];
/** The standard commitment discount (apps/api/src/services/billing/terms.ts). */
export function standardDiscount(cycle: Cycle, termMonths: number | null): number {
  const months = termMonths ?? (cycle === 'ANNUAL' ? 12 : 0);
  const base = months >= 60 ? 12 : months >= 48 ? 10 : months >= 36 ? 8 : months >= 24 ? 6 : months >= 12 ? 4 : 0;
  return base + (cycle === 'TERM' && base ? 2 : 0);
}
