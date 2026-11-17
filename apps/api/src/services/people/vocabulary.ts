/**
 * The words an organization's screens use for the built-in roles (ARCHITECTURE-REVIEW section B).
 * The built-in roles were named for aquatics ("Lifeguard / instructor", "Aquatic supervisor"); a
 * library, a water utility or a private employer shouldn't see pool words. So:
 *
 * - profile: the organization's choice (Tenant.roleVocabulary) when it made one. Otherwise worked
 *   out: PRIVATE for private employers (the CLUB plan); AQUATIC where it has pools (a pool body or an
 *   aquatic department; a facility's venue kind defaults to POOL, so it isn't evidence); MUNICIPAL
 *   when it has set up departments and none is aquatic. An organization with neither yet (one being
 *   set up) keeps the aquatic words, as before. The web app picks neutral or private-sector default
 *   names from it (locales roleNames.*).
 * - roleLabels: the organization's own names for any built-in role, in English and French, set by its
 *   administrators (Tenant.roleLabels). They win over every default.
 *
 * Only words change: what each role may do is untouched.
 */
import type { AccessRole } from '../../generated/prisma/client.js';
import { type Tx, db } from '../../lib/db.js';

export const ACCESS_ROLES: AccessRole[] = ['HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD', 'STAFF', 'FRONT_DESK', 'UNION_STEWARD', 'EMPLOYEE'];
export type Profile = 'AQUATIC' | 'MUNICIPAL' | 'PRIVATE';
export type RoleLabels = Partial<Record<AccessRole, { en: string; fr: string }>>;

/** Stored labels, keeping only well-formed entries for known roles. */
export function readRoleLabels(v: unknown): RoleLabels {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: RoleLabels = {};
  for (const r of ACCESS_ROLES) {
    const x = (v as Record<string, unknown>)[r] as { en?: unknown; fr?: unknown } | undefined;
    if (x && typeof x.en === 'string' && typeof x.fr === 'string' && x.en.trim() && x.fr.trim()) out[r] = { en: x.en, fr: x.fr };
  }
  return out;
}

export function profileOf(input: { chosen: Profile | null; plan: 'MUNICIPAL' | 'CLUB' | null; pools: number; aquaticDepartments: number; departments: number }): Profile {
  if (input.chosen) return input.chosen;
  if (input.plan === 'CLUB') return 'PRIVATE';
  if (input.pools + input.aquaticDepartments > 0) return 'AQUATIC';
  return input.departments > 0 ? 'MUNICIPAL' : 'AQUATIC';
}

/** The organization's profile and own role names. */
export async function vocabularyOf(tx: Tx, tenantId: string): Promise<{ profile: Profile; chosen: Profile | null; roleLabels: RoleLabels }> {
  const [tenant, account, pools, aquaticDepartments, departments] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { roleLabels: true, roleVocabulary: true } }),
    // Billing records live outside the organization's tables (FH's books), read as billingState does.
    db().billingAccount.findUnique({ where: { tenantId }, select: { plan: true } }),
    tx.poolBody.count(),
    tx.department.count({ where: { aquatic: true } }),
    tx.department.count(),
  ]);
  const chosen = tenant.roleVocabulary;
  return { profile: profileOf({ chosen, plan: account?.plan ?? null, pools, aquaticDepartments, departments }), chosen, roleLabels: readRoleLabels(tenant.roleLabels) };
}
