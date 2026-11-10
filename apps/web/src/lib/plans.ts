/** The plan catalogue as the API sends it (apps/api/src/services/billing/catalog.ts). */
export type PlanLevel = 'SMALL' | 'BUSINESS' | 'MULTI_COMPLEX' | 'ENTERPRISE';
export const PLAN_LEVELS: PlanLevel[] = ['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE'];
export type Module = 'operations' | 'programs' | 'fleetWinter' | 'hrCompliance' | 'hrSuite' | 'benchmarks' | 'sso' | 'bankConnection' | 'union';
export const MODULES: Module[] = ['operations', 'programs', 'fleetWinter', 'hrCompliance', 'hrSuite', 'benchmarks', 'sso', 'bankConnection', 'union'];

export interface PublicPlan { listCents: number; quoted: boolean; staffPerFacility: number | null; extraStaffCents: number; modules: Module[]; service: string[] }
export interface Catalog {
  modules: Record<Module, { features: string[]; privateCents: number }>;
  public: Record<PlanLevel, PublicPlan>;
  sizePercent: Record<string, number>;
  publicExtras: Partial<Record<Module, number>>;
  private: { coreCents: number; includedUsers: number; userCents: number };
}

export const cents = (c: number, lng: string, whole = true) =>
  new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD', maximumFractionDigits: whole && c % 100 === 0 ? 0 : 2 }).format(c / 100);
