import type { AccessRole } from '@prisma/client';
/**
 * Feature switches, set per organization from the FH Dev console.
 *
 * A switched-off feature removes its permissions from everyone in the
 * organization (so its screens disappear) and its routes refuse requests.
 * Scheduling, staff, certifications and settings are the core and can't be
 * switched off.
 */
import type { Permission } from '../../auth/permissions.js';
import { type RoleOverrides, parseOverrides } from './roleOverrides.js';
import { withTenant } from '../../lib/db.js';
import { type BillingState, billingState } from '../billing/entitlements.js';

export const FEATURES = {
  shiftBoard: { default: true, permissions: ['shiftboard.claim', 'shiftboard.post', 'shiftboard.approve', 'shiftboard.assign_emergency'] },
  scheduleAssistant: { default: true, permissions: ['schedule.assist'] },
  availability: { default: true, permissions: ['availability.self'] },
  timeOff: { default: true, permissions: ['timeoff.self', 'timeoff.approve'] },
  timeclock: { default: true, permissions: ['timeclock.punch', 'timeclock.review'] },
  lessons: { default: true, permissions: ['lessons.teach'] },
  poolChemistry: { default: true, permissions: ['ops.chemical.record', 'ops.chemical.signoff', 'ops.pool.close', 'ops.configure'] },
  headcounts: { default: true, permissions: ['ops.headcount.record'] },
  statusBoard: { default: true, permissions: ['ops.status.read', 'ops.page_head_guard'] },
  incidents: { default: true, permissions: ['incidents.create', 'incidents.read'] },
  discipline: { default: true, permissions: ['discipline.read', 'discipline.write'] },
  reliability: { default: true, permissions: ['reliability.read', 'reliability.write'] },
  payroll: { default: true, permissions: ['payroll.export'] },
  jobs: { default: true, permissions: ['jobs.manage'] },
  union: { default: false, permissions: ['union.hub', 'seniority.read'] },
  rotations: { default: true, permissions: ['deck.rotate'] },
  benchmarks: { default: true, permissions: [] },
  accommodation: { default: true, permissions: ['accommodation.manage'] },
  care: { default: true, permissions: ['care.manage'] },
  loneWork: { default: true, permissions: ['lonework.self', 'lonework.monitor'] },
  /** Off until the city's managers switch them on (Winter operations screen). */
  callOuts: { default: false, permissions: ['winter.callout'] },
  patrols: { default: false, permissions: ['winter.patrol', 'winter.records'] },
  overtime: { default: true, permissions: ['overtime.manage'] },
  onboarding: { default: true, permissions: ['onboarding.hr', 'onboarding.lead', 'onboarding.configure'] },
  emailNotifications: { default: true, permissions: [] },
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

/** Cached per process; the Dev console clears it when switches change. */
export async function tenantFeatures(tenantId: string): Promise<FeatureSet> {
  return (await tenantSettings(tenantId)).features;
}

/** Feature switches and per-role overrides, cached together. */
export interface TenantSettings { features: FeatureSet; overrides: RoleOverrides; mfaRoles: AccessRole[]; billing: BillingState }

export async function tenantSettings(tenantId: string): Promise<TenantSettings> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const row = await withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { features: true, roleOverrides: true, mfaRoles: true } }));
  const billing = await billingState(tenantId);
  // A feature the plan doesn't include is off, whatever its switch says.
  const features = resolveFeatures(row?.features);
  for (const k of Object.keys(billing.locked) as FeatureKey[]) features[k] = false;
  const entry = { at: Date.now(), features, overrides: parseOverrides(row?.roleOverrides), mfaRoles: row?.mfaRoles ?? [], billing };
  cache.set(tenantId, entry);
  return entry;
}

export function forgetFeatures(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
