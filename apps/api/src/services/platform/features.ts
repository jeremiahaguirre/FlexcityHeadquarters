/**
 * Feature switches, set per organization from the FH Dev console.
 *
 * A switched-off feature removes its permissions from everyone in the
 * organization (so its screens disappear) and its routes refuse requests.
 * Scheduling, staff, certifications and settings are the core and can't be
 * switched off.
 */
import type { AccessRole } from '@prisma/client';
import type { Permission } from '../../auth/permissions.js';
import { type RoleOverrides, parseOverrides } from './roleOverrides.js';
import { withTenant } from '../../lib/db.js';
import { type BillingState, billingState } from '../billing/entitlements.js';
import { sharedForget } from '../../lib/cacheBus.js';
import { singleFlight } from '../../lib/singleFlight.js';

export const FEATURES = {
  shiftBoard: { default: true, permissions: ['shiftboard.claim', 'shiftboard.post', 'shiftboard.approve', 'shiftboard.assign_emergency'] },
  scheduleAssistant: { default: true, permissions: ['schedule.assist'] },
  availability: { default: true, permissions: ['availability.self'] },
  /** Weekly shift templates: a department's standard week applied to future weeks as drafts. */
  shiftTemplates: { default: true, permissions: ['schedule.templates'] },
  /** Staff state the shifts they'd like or avoid; Fill the schedule weighs them (soft only). */
  shiftPreferences: { default: true, permissions: ['preferences.self'] },
  timeOff: { default: true, permissions: ['timeoff.self', 'timeoff.approve'] },
  timeclock: { default: true, permissions: ['timeclock.punch', 'timeclock.review'] },
  lessons: { default: true, permissions: ['lessons.teach'] },
  poolChemistry: { default: true, permissions: ['ops.chemical.record', 'ops.chemical.signoff', 'ops.pool.close', 'ops.configure'] },
  headcounts: { default: true, permissions: ['ops.headcount.record'] },
  statusBoard: { default: true, permissions: ['ops.status.read', 'ops.page_head_guard'] },
  incidents: { default: true, permissions: ['incidents.create', 'incidents.read'] },
  discipline: { default: true, permissions: ['discipline.read', 'discipline.write'] },
  /** Leave balances, performance reviews, training records and grievances. */
  hrSuite: { default: true, permissions: ['leave.manage', 'performance.manage', 'training.manage', 'grievances.manage', 'policies.manage'] },
  reliability: { default: true, permissions: ['reliability.read', 'reliability.write'] },
  payroll: { default: true, permissions: ['payroll.export', 'payroll.approve', 'benefits.manage', 'accounting.manage'] },
  jobs: { default: true, permissions: ['jobs.manage'] },
  union: { default: false, permissions: ['union.hub', 'seniority.read'] },
  /** Seniority dates and hours break ties in the overtime order, call-outs and the scheduling assistant. Each organization chooses (Settings), and so can the Dev console. */
  seniority: { default: true, permissions: ['seniority.read'] },
  rotations: { default: true, permissions: ['deck.rotate'] },
  benchmarks: { default: true, permissions: [] },
  accommodation: { default: true, permissions: ['accommodation.manage'] },
  care: { default: true, permissions: ['care.manage'] },
  /** Lesson and swim club campaigns, member services and the price list. */
  registration: { default: true, permissions: ['lessons.plan', 'members.manage', 'fees.manage', 'bookings.manage'] },
  coverage: { default: true, permissions: ['coverage.manage'] },
  fleet: { default: true, permissions: ['fleet.inspect', 'fleet.manage'] },
  injuryClaims: { default: true, permissions: ['injury.manage'] },
  loneWork: { default: true, permissions: ['lonework.self', 'lonework.monitor'] },
  /** Off until the city's managers switch them on (Winter operations screen). */
  callOuts: { default: false, permissions: ['winter.callout'] },
  patrols: { default: false, permissions: ['winter.patrol', 'winter.records'] },
  overtime: { default: true, permissions: ['overtime.manage'] },
  /** Expense and mileage claims, paid back on pay runs. */
  expenses: { default: true, permissions: ['expenses.self', 'expenses.approve'] },
  onboarding: { default: true, permissions: ['onboarding.hr', 'onboarding.lead', 'onboarding.configure'] },
  emailNotifications: { default: true, permissions: [] },
  logbook: { default: true, permissions: ['logbook.write'] },
  announcements: { default: true, permissions: ['announcements.post'] },
  /** Team messaging: one to one, shift, department and group conversations (services/messaging). */
  messaging: { default: true, permissions: ['messages.use', 'messages.groups', 'messages.investigate'] },
  /** Short staff surveys: anonymous pulse check-ins and exit surveys (services/surveys). Part of the HR suite option. */
  surveys: { default: true, permissions: ['surveys.respond', 'surveys.manage', 'surveys.department'] },
  /** Urgent texts and calls (working alone, call-outs, last-minute shifts). Off until the city turns it on: messages cost money. */
  textAlerts: { default: false, permissions: [] },
} as const satisfies Record<string, { default: boolean; permissions: readonly Permission[] }>;

export type FeatureKey = keyof typeof FEATURES;
export type FeatureSet = Record<FeatureKey, boolean>;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Stored switches (possibly partial or stale) → a full set with defaults. */
export function resolveFeatures(stored: unknown): FeatureSet {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, typeof s[k] === 'boolean' ? s[k] : FEATURES[k].default])) as FeatureSet;
}

export function withoutDisabled<P extends string>(permissions: Set<P>, features: FeatureSet): Set<P> {
  const out = new Set(permissions);
  for (const k of FEATURE_KEYS) if (!features[k]) for (const p of FEATURES[k].permissions) out.delete(p as P);
  return out;
}

const cache = new Map<string, TenantSettings & { at: number }>();
const TTL_MS = 30_000;
const flight = singleFlight<TenantSettings>();

/** Cached per process for 30 s; changes clear it in every process (forgetFeatures). */
export async function tenantFeatures(tenantId: string): Promise<FeatureSet> {
  return (await tenantSettings(tenantId)).features;
}

/** Feature switches and per-role overrides, cached together. */
export interface TenantSettings { features: FeatureSet; overrides: RoleOverrides; mfaRoles: AccessRole[]; billing: BillingState; disabledAt?: Date | null; exportUntil?: Date | null }

export async function tenantSettings(tenantId: string): Promise<TenantSettings> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  return flight.run(tenantId, () => loadSettings(tenantId));
}

async function loadSettings(tenantId: string): Promise<TenantSettings> {
  const gen = flight.generation;
  const row = await withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { features: true, roleOverrides: true, mfaRoles: true, disabledAt: true, exportUntil: true } }));
  const billing = await billingState(tenantId);
  // A feature the plan doesn't include is off, whatever its switch says.
  const features = resolveFeatures(row?.features);
  for (const k of Object.keys(billing.locked) as FeatureKey[]) features[k] = false;
  const entry = { at: Date.now(), features, overrides: parseOverrides(row?.roleOverrides), mfaRoles: row?.mfaRoles ?? [], billing, disabledAt: row?.disabledAt ?? null, exportUntil: row?.exportUntil ?? null };
  if (flight.fresh(gen)) cache.set(tenantId, entry);
  return entry;
}

/** Drops the cached settings here and in every other API process (lib/cacheBus.ts). */
export const forgetFeatures = sharedForget('features', (tenantId) => {
  flight.forget(tenantId);
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
});
