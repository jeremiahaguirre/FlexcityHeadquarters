/**
 * What an organization owes for a month, from the plan catalogue (catalog.ts):
 * - Public sector: the plan's rate (list, or the quoted rate) per facility, scaled by the
 *   facility's size; a facility's own contract price wins. Staff places and overage. Then each
 *   option switched away from the plan: added ones billed, removed standard ones credited.
 * - Private sector: the core fee with 20 active users, then per active user, plus each option on.
 * Each option bills at the organization's own price when one is set, else the standard price.
 */
import { type PlanLevel, PRIVATE_INCLUDED_USERS, PRIVATE_CORE_CENTS, PUBLIC_PLANS, SIZE_PERCENT, itemStates } from './catalog.js';

export interface PricingInput {
  plan: 'MUNICIPAL' | 'CLUB';
  level: PlanLevel;
  quotedRateCents: number | null;
  /** Quoted staff allowance (quoted plans); null = from the facilities. */
  includedStaff?: number | null;
  /** Extra staff places added to the plan, billed every month. */
  extraStaffSeats?: number;
  /** Per-organization option choices (BillingAccount.items). */
  items: unknown;
  facilities: Array<{ name: string; tier: number | null; customCents: number | null }>;
  activeUsers: number;
  clubUserRateCents: number;
}
export interface Line { kind: string; description: string; quantity: number; unitCents: number; amountCents: number }

/** The rate per standard facility: the quoted rate for plans priced after a quote, else the list price. */
export function planRate(level: PlanLevel, quotedRateCents: number | null) {
  return PUBLIC_PLANS[level].quoted && quotedRateCents !== null ? quotedRateCents : PUBLIC_PLANS[level].listCents;
}

/** Active staff the plan includes: per billed facility, scaled by size; null = unlimited. */
export function staffAllowance(input: Pick<PricingInput, 'level' | 'facilities' | 'includedStaff'>): number | null {
  const per = PUBLIC_PLANS[input.level].staffPerFacility;
  if (per === null) return null;
  if (PUBLIC_PLANS[input.level].quoted && input.includedStaff != null) return input.includedStaff;
  return input.facilities.filter((f) => f.tier || f.customCents !== null).reduce((n, f) => n + Math.round((per * (SIZE_PERCENT[f.tier ?? 2] ?? 100)) / 100), 0);
}

export function monthlyLines(input: PricingInput, label: (key: string, vars?: Record<string, string | number>) => string): Line[] {
  const lines: Line[] = [];
  const states = itemStates({ plan: input.plan, level: input.level, items: input.items });
  if (input.plan === 'MUNICIPAL') {
    const rate = planRate(input.level, input.quotedRateCents);
    const plan = label(`plan_${input.level}`);
    for (const f of input.facilities) {
      if (f.customCents === null && !f.tier) continue;
      const unit = f.customCents ?? Math.round((rate * (SIZE_PERCENT[f.tier!] ?? 100)) / 100);
      lines.push({ kind: 'facility', description: label(f.customCents !== null ? 'facilityCustom' : `size${f.tier}`, { name: f.name, plan }), quantity: 1, unitCents: unit, amountCents: unit });
    }
    if (lines.length) {
      const allowance = staffAllowance(input);
      if (allowance !== null) {
        const unit = PUBLIC_PLANS[input.level].extraStaffCents;
        const seats = input.extraStaffSeats ?? 0;
        if (seats) lines.push({ kind: 'staff_seats', description: label('staffSeats'), quantity: seats, unitCents: unit, amountCents: seats * unit });
        const over = input.activeUsers - allowance - seats;
        if (over > 0) lines.push({ kind: 'extra_staff', description: label('extraStaff', { active: input.activeUsers, included: allowance + seats }), quantity: over, unitCents: unit, amountCents: over * unit });
      }
    }
    if (lines.length)
      for (const it of states) {
        if (it.on === it.standard || !it.cents) continue;
        const amount = it.on ? it.cents : -it.cents;
        lines.push({ kind: it.on ? `item_${it.key}` : `credit_${it.key}`, description: label(it.on ? 'itemAdded' : 'itemRemoved', { name: label(`item_${it.key}`) }), quantity: 1, unitCents: amount, amountCents: amount });
      }
  } else {
    lines.push({ kind: 'club_base', description: label('clubBase', { included: PRIVATE_INCLUDED_USERS }), quantity: 1, unitCents: PRIVATE_CORE_CENTS, amountCents: PRIVATE_CORE_CENTS });
    const seats = input.extraStaffSeats ?? 0;
    if (seats) lines.push({ kind: 'staff_seats', description: label('staffSeats'), quantity: seats, unitCents: input.clubUserRateCents, amountCents: seats * input.clubUserRateCents });
    const extra = Math.max(0, input.activeUsers - PRIVATE_INCLUDED_USERS - seats);
    if (extra) lines.push({ kind: 'club_users', description: label('clubUsers', { active: input.activeUsers, included: PRIVATE_INCLUDED_USERS + seats }), quantity: extra, unitCents: input.clubUserRateCents, amountCents: extra * input.clubUserRateCents });
    for (const it of states) {
      if (!it.on || !it.cents) continue;
      lines.push({ kind: `item_${it.key}`, description: label(`item_${it.key}`), quantity: 1, unitCents: it.cents, amountCents: it.cents });
    }
  }
  return lines;
}

const EN: Record<string, string> = {
  plan_SMALL: 'Small',
  plan_BUSINESS: 'Business',
  plan_MULTI_COMPLEX: 'Multi-complex',
  plan_ENTERPRISE: 'Enterprise',
  size1: '{plan} plan, seasonal or outdoor facility: {name}',
  size2: '{plan} plan, facility: {name}',
  size3: '{plan} plan, major complex: {name}',
  facilityCustom: '{plan} plan, facility (contract rate): {name}',
  clubBase: 'Core plan, includes {included} active users',
  clubUsers: 'Active users beyond {included} ({active} active this month)',
  extraStaff: 'Active staff beyond the {included} included ({active} active this month)',
  staffSeats: 'Staff places added to the plan',
  item_poolChemistry: 'Water chemistry and closures',
  item_incidents: 'Incident reports',
  item_statusBoard: 'Front-desk status board',
  item_rotations: 'Deck rotation',
  item_registration: 'Programs and registration',
  item_fleet: 'Fleet: inspections, licences, hours of service',
  item_winter: 'Winter call-outs and patrols',
  item_onboarding: 'Onboarding checks',
  item_reliability: 'People review',
  item_discipline: 'Discipline records',
  item_accommodation: 'Accommodation cases',
  item_hrSuite: 'HR Suite: leave, reviews, training, grievances, offboarding',
  item_benchmarks: 'Benchmarks',
  item_sso: 'Single sign-on',
  item_bankConnection: 'Bank connection',
  item_union: 'Union hub',
  itemAdded: 'Added to the plan: {name}',
  itemRemoved: 'Removed from the plan: {name}',
};
const FR: Record<string, string> = {
  plan_SMALL: 'Petit',
  plan_BUSINESS: 'Affaires',
  plan_MULTI_COMPLEX: 'Multicomplexe',
  plan_ENTERPRISE: 'Entreprise',
  size1: 'Forfait {plan}, installation saisonnière ou extérieure : {name}',
  size2: 'Forfait {plan}, installation : {name}',
  size3: 'Forfait {plan}, grand complexe : {name}',
  facilityCustom: 'Forfait {plan}, installation (tarif contractuel) : {name}',
  clubBase: 'Forfait de base, {included} utilisateurs actifs inclus',
  clubUsers: 'Utilisateurs actifs au-delà de {included} ({active} actifs ce mois-ci)',
  extraStaff: 'Personnel actif au-delà des {included} inclus ({active} actifs ce mois-ci)',
  staffSeats: 'Places de personnel ajoutées au forfait',
  item_poolChemistry: 'Chimie de l’eau et fermetures',
  item_incidents: 'Rapports d’incident',
  item_statusBoard: 'Tableau de l’accueil',
  item_rotations: 'Rotation sur la plage',
  item_registration: 'Programmes et inscriptions',
  item_fleet: 'Véhicules : inspections, permis, heures de service',
  item_winter: 'Rappels et patrouilles hivernales',
  item_onboarding: 'Vérifications d’intégration',
  item_reliability: 'Suivi du personnel',
  item_discipline: 'Dossiers disciplinaires',
  item_accommodation: 'Dossiers d’adaptation',
  item_hrSuite: 'Suite RH : congés, évaluations, formation, griefs, départs',
  item_benchmarks: 'Comparaisons',
  item_sso: 'Authentification unique',
  item_bankConnection: 'Connexion bancaire',
  item_union: 'Carrefour syndical',
  itemAdded: 'Ajouté au forfait : {name}',
  itemRemoved: 'Retiré du forfait : {name}',
};
/** Invoice wording in the organization's language. */
export const lineLabel = (locale: string) => (key: string, vars: Record<string, string | number> = {}) =>
  (locale.startsWith('fr') ? FR : EN)[key]!.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** This month's staff against the plan, for the Dev console and the organization's Billing page. */
export function staffUsage(input: PricingInput) {
  const seats = input.extraStaffSeats ?? 0;
  if (input.plan === 'CLUB') return { active: input.activeUsers, included: PRIVATE_INCLUDED_USERS, seats, unlimited: false, over: Math.max(0, input.activeUsers - PRIVATE_INCLUDED_USERS - seats), rateCents: input.clubUserRateCents };
  const allowance = staffAllowance(input);
  if (allowance === null) return { active: input.activeUsers, included: null, seats: 0, unlimited: true, over: 0, rateCents: 0 };
  return { active: input.activeUsers, included: allowance, seats, unlimited: false, over: Math.max(0, input.activeUsers - allowance - seats), rateCents: PUBLIC_PLANS[input.level].extraStaffCents };
}
