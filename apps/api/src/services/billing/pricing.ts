/**
 * What an organization owes for a month, from docs/PRICING.md:
 * - Municipal: per facility by tier (or a custom rate), unlimited staff.
 * - Club: base fee including 20 active users, then per active user.
 * - Add-ons on the subscription subtotal: HR Compliance +20%, Operations +15%.
 */
export const TIER_CENTS: Record<number, number> = { 1: 100_000, 2: 250_000, 3: 500_000 };
export const CLUB_BASE_CENTS = 9_900;
export const CLUB_INCLUDED_USERS = 20;
export const ADD_ON_PERCENT = { hr: 20, ops: 15 } as const;

export interface PricingInput {
  plan: 'MUNICIPAL' | 'CLUB';
  facilities: Array<{ name: string; tier: number | null; customCents: number | null }>;
  activeUsers: number;
  clubUserRateCents: number;
  addOnHr: boolean;
  addOnOps: boolean;
}
export interface Line { kind: string; description: string; quantity: number; unitCents: number; amountCents: number }

const pct = (cents: number, percent: number) => Math.round((cents * percent) / 100);

export function monthlyLines(input: PricingInput, label: (key: string, vars?: Record<string, string | number>) => string): Line[] {
  const lines: Line[] = [];
  if (input.plan === 'MUNICIPAL') {
    for (const f of input.facilities) {
      const unit = f.customCents ?? (f.tier ? TIER_CENTS[f.tier] : undefined);
      if (unit === undefined) continue;
      lines.push({ kind: 'facility', description: label(f.customCents !== null ? 'facilityCustom' : `tier${f.tier}`, { name: f.name }), quantity: 1, unitCents: unit, amountCents: unit });
    }
  } else {
    lines.push({ kind: 'club_base', description: label('clubBase', { included: CLUB_INCLUDED_USERS }), quantity: 1, unitCents: CLUB_BASE_CENTS, amountCents: CLUB_BASE_CENTS });
    const extra = Math.max(0, input.activeUsers - CLUB_INCLUDED_USERS);
    if (extra) lines.push({ kind: 'club_users', description: label('clubUsers', { active: input.activeUsers, included: CLUB_INCLUDED_USERS }), quantity: extra, unitCents: input.clubUserRateCents, amountCents: extra * input.clubUserRateCents });
  }
  const base = lines.reduce((s, l) => s + l.amountCents, 0);
  if (base && input.addOnHr) lines.push({ kind: 'addon_hr', description: label('addOnHr', { percent: ADD_ON_PERCENT.hr }), quantity: 1, unitCents: pct(base, ADD_ON_PERCENT.hr), amountCents: pct(base, ADD_ON_PERCENT.hr) });
  if (base && input.addOnOps) lines.push({ kind: 'addon_ops', description: label('addOnOps', { percent: ADD_ON_PERCENT.ops }), quantity: 1, unitCents: pct(base, ADD_ON_PERCENT.ops), amountCents: pct(base, ADD_ON_PERCENT.ops) });
  return lines;
}

const EN: Record<string, string> = {
  tier1: 'Facility licence, tier 1 (minor / seasonal): {name}',
  tier2: 'Facility licence, tier 2 (standard recreation centre): {name}',
  tier3: 'Facility licence, tier 3 (major complex): {name}',
  facilityCustom: 'Facility licence (contract rate): {name}',
  clubBase: 'Platform fee, includes {included} active users',
  clubUsers: 'Active users beyond {included} ({active} active this month)',
  addOnHr: 'HR Compliance add-on (+{percent}%)',
  addOnOps: 'Operations add-on (+{percent}%)',
};
const FR: Record<string, string> = {
  tier1: 'Licence d’installation, niveau 1 (petite / saisonnière) : {name}',
  tier2: 'Licence d’installation, niveau 2 (centre récréatif) : {name}',
  tier3: 'Licence d’installation, niveau 3 (grand complexe) : {name}',
  facilityCustom: 'Licence d’installation (tarif contractuel) : {name}',
  clubBase: 'Frais de plateforme, {included} utilisateurs actifs inclus',
  clubUsers: 'Utilisateurs actifs au-delà de {included} ({active} actifs ce mois-ci)',
  addOnHr: 'Module Conformité RH (+{percent} %)',
  addOnOps: 'Module Opérations (+{percent} %)',
};
/** Invoice wording in the organization's language. */
export const lineLabel = (locale: string) => (key: string, vars: Record<string, string | number> = {}) =>
  (locale.startsWith('fr') ? FR : EN)[key]!.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
