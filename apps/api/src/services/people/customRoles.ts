/**
 * Roles an organization defines for any job: a water works operator, a
 * maintenance supervisor, a parks manager, an arena lead, an HR assistant.
 *
 * - A role is any set of capabilities from the catalogue (everything except
 *   the union hub, which follows union membership, not the employer).
 * - A role can be limited to a department: lead and manager capabilities then
 *   reach only people holding the role's positions, and shifts at its facilities.
 * - No escalation: HR and managers can only grant capabilities they hold
 *   themselves, inside their own department. The Dev console can grant any.
 */
import type { Permission } from '../../auth/permissions.js';
import { z } from 'zod';
import { type Tx, withTenant } from '../../lib/db.js';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors.js';

export const CUSTOM_ROLE_PERMISSIONS = {
  everyday: ['schedule.read', 'shifts.self', 'timeclock.punch', 'timeoff.self', 'availability.self', 'lonework.self'],
  shiftBoard: ['shiftboard.claim', 'shiftboard.post'],
  safety: ['incidents.create', 'ops.headcount.record'],
  memberServices: ['members.manage', 'lessons.plan', 'fees.manage', 'bookings.manage'],
  winter: ['winter.patrol', 'winter.callout', 'winter.records', 'winter.manage'],
  aquatics: ['lessons.teach', 'ops.chemical.record', 'ops.chemical.signoff', 'ops.pool.close', 'ops.status.read', 'ops.page_head_guard', 'deck.rotate', 'ops.configure'],
  lead: ['users.read', 'users.scheduling', 'schedule.write', 'schedule.assist', 'shiftboard.approve', 'shiftboard.assign_emergency', 'timeoff.approve', 'timeclock.review', 'certs.verify', 'lonework.monitor', 'onboarding.lead', 'overtime.manage', 'coverage.manage'],
  manager: ['reliability.read', 'reliability.write', 'discipline.read', 'discipline.write', 'incidents.read', 'care.manage', 'compliance.report', 'payroll.export', 'positions.manage', 'jobs.manage', 'roles.manage'],
  admin: ['users.write', 'users.privacy', 'audit.read', 'onboarding.hr', 'onboarding.configure', 'accommodation.manage', 'tenant.configure', 'billing.manage'],
} as const satisfies Record<string, readonly Permission[]>;

export const ALLOWED_CUSTOM_PERMISSIONS: ReadonlySet<Permission> = new Set(Object.values(CUSTOM_ROLE_PERMISSIONS).flat());
export const isAllowedCustomPermission = (p: string): p is Permission => ALLOWED_CUSTOM_PERMISSIONS.has(p as Permission);

/** Capabilities that act on other people or their shifts: these follow a role's department. */
export const SUPERVISORY: ReadonlySet<Permission> = new Set([...CUSTOM_ROLE_PERMISSIONS.lead, ...CUSTOM_ROLE_PERMISSIONS.manager, ...CUSTOM_ROLE_PERMISSIONS.admin, 'winter.callout', 'winter.records', 'winter.manage']);

/** null = the whole organization. */
export type Scope = { positionIds: string[]; facilityIds: string[] } | null;

interface CustomAccess { perms: Set<Permission>; roles: Array<{ perms: Permission[]; positionIds: string[]; facilityIds: string[] }> }
const cache = new Map<string, { at: number } & CustomAccess>();
const TTL_MS = 30_000;

/** A person's custom roles: their capabilities and departments (cached briefly per person). */
export async function customAccess(tenantId: string, userId: string): Promise<CustomAccess> {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const rows = await withTenant(tenantId, (tx) => tx.userCustomRole.findMany({ where: { userId }, include: { customRole: { select: { permissions: true, scopePositionIds: true, scopeFacilityIds: true } } } }));
  // Filter again on the way out: the catalogue is the rule, whatever is stored.
  const roles = rows.map((r) => ({ perms: r.customRole.permissions.filter(isAllowedCustomPermission), positionIds: r.customRole.scopePositionIds, facilityIds: r.customRole.scopeFacilityIds }));
  const entry = { at: Date.now(), perms: new Set(roles.flatMap((r) => r.perms)), roles };
  cache.set(key, entry);
  return entry;
}

export async function customPermissions(tenantId: string, userId: string): Promise<Set<Permission>> {
  return (await customAccess(tenantId, userId)).perms;
}

/**
 * Where a person's supervisory capabilities reach. Whole organization if any
 * of them comes from a built-in role or an unscoped custom role.
 */
export function scopeOf(builtIn: ReadonlySet<Permission>, access: CustomAccess): Scope {
  if ([...builtIn].some((p) => SUPERVISORY.has(p))) return null;
  const leads = access.roles.filter((r) => r.perms.some((p) => SUPERVISORY.has(p)));
  if (!leads.length || leads.some((r) => !r.positionIds.length && !r.facilityIds.length)) return null;
  return { positionIds: [...new Set(leads.flatMap((r) => r.positionIds))], facilityIds: [...new Set(leads.flatMap((r) => r.facilityIds))] };
}

export function forgetCustomPermissions(tenantId?: string): void {
  if (!tenantId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}

/** Who is creating or assigning a role: HR or a manager (null = the Dev console). */
export interface RoleActor { permissions: ReadonlySet<Permission>; scope: Scope }

const within = (inner: string[], outer: string[]) => !outer.length || (inner.length > 0 && inner.every((x) => outer.includes(x)));
/** Can this actor grant this role? Only capabilities they hold, only inside their department. */
export function covers(actor: RoleActor | null, role: { permissions: string[]; scopePositionIds: string[]; scopeFacilityIds: string[] }): boolean {
  if (!actor) return true;
  // The organization's own administrators (unscoped, may configure the organization) can grant any role.
  if (!actor.scope && actor.permissions.has('tenant.configure')) return true;
  if (!role.permissions.every((p) => actor.permissions.has(p as Permission))) return false;
  if (!actor.scope) return true;
  return within(role.scopePositionIds, actor.scope.positionIds) && within(role.scopeFacilityIds, actor.scope.facilityIds);
}

// ------------------------------------------------------- Create / change / remove

export const customRoleBody = z.object({
  name: z.string().trim().min(2).max(60),
  nameFr: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.string()).min(1).max(60),
  scopePositionIds: z.array(z.string().uuid()).max(50).optional(),
  scopeFacilityIds: z.array(z.string().uuid()).max(50).optional(),
});
export type CustomRoleInput = z.infer<typeof customRoleBody>;

export async function saveCustomRole(tx: Tx, tenantId: string, id: string | null, body: CustomRoleInput, actor: RoleActor | null = null) {
  const bad = body.permissions.filter((p) => !isAllowedCustomPermission(p));
  if (bad.length) throw new HttpError(400, 'PERMISSION_NOT_ALLOWED', `A custom role can't include: ${bad.join(', ')}.`, { permissions: bad });
  const scopePositionIds = [...new Set(body.scopePositionIds ?? [])];
  const scopeFacilityIds = [...new Set(body.scopeFacilityIds ?? [])];
  if ((await tx.position.count({ where: { id: { in: scopePositionIds } } })) !== scopePositionIds.length) throw new HttpError(400, 'UNKNOWN_POSITION', 'Unknown position.');
  if ((await tx.facility.count({ where: { id: { in: scopeFacilityIds } } })) !== scopeFacilityIds.length) throw new HttpError(400, 'UNKNOWN_FACILITY', 'Unknown facility.');
  const proposed = { permissions: body.permissions, scopePositionIds, scopeFacilityIds };
  if (!covers(actor, proposed)) throw forbidden('You can only give a role capabilities you have yourself, within your own department.');
  if (id) {
    const existing = await tx.customRole.findUnique({ where: { id } });
    if (existing && !covers(actor, existing)) throw forbidden('This role has capabilities or a department beyond yours.');
  }
  const clash = await tx.customRole.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict('ROLE_EXISTS', 'There is already a role with that name.');
  const data = { name: body.name, nameFr: body.nameFr ?? null, description: body.description ?? null, permissions: [...new Set(body.permissions)], scopePositionIds, scopeFacilityIds };
  if (id) {
    if (!(await tx.customRole.findUnique({ where: { id } }))) throw notFound('Role');
    await tx.customRole.update({ where: { id }, data });
  }
  const role = id ? await tx.customRole.findUniqueOrThrow({ where: { id } }) : await tx.customRole.create({ data: { ...data, tenantId } });
  forgetCustomPermissions(tenantId);
  return role;
}

export async function deleteCustomRole(tx: Tx, tenantId: string, id: string, actor: RoleActor | null = null) {
  const existing = await tx.customRole.findUnique({ where: { id } });
  if (existing && !covers(actor, existing)) throw forbidden('This role has capabilities or a department beyond yours.');
  const gone = await tx.customRole.deleteMany({ where: { id } });
  if (!gone.count) throw notFound('Role');
  forgetCustomPermissions(tenantId);
}

export async function listCustomRoles(tx: Tx) {
  const roles = await tx.customRole.findMany({ include: { _count: { select: { members: true } } }, orderBy: { name: 'asc' } });
  return roles.map((r) => ({ id: r.id, name: r.name, nameFr: r.nameFr, description: r.description, permissions: r.permissions, scopePositionIds: r.scopePositionIds, scopeFacilityIds: r.scopeFacilityIds, members: r._count.members }));
}

/**
 * Replaces a person's custom roles; ids must be this organization's roles (row-level security hides others).
 * A manager only adds or removes roles they could grant; others the person holds are kept.
 */
export async function setUserCustomRoles(tx: Tx, tenantId: string, userId: string, ids: string[], actor: RoleActor | null = null) {
  const unique = [...new Set(ids)];
  const wanted = await tx.customRole.findMany({ where: { id: { in: unique } } });
  if (wanted.length !== unique.length) throw new HttpError(400, 'UNKNOWN_ROLE', 'Unknown role.');
  const held = await tx.userCustomRole.findMany({ where: { userId }, include: { customRole: true } });
  const kept = held.filter((h) => !covers(actor, h.customRole)).map((h) => h.customRoleId);
  const added = wanted.filter((r) => !held.some((h) => h.customRoleId === r.id));
  if (added.some((r) => !covers(actor, r))) throw forbidden('You can only give roles with capabilities you have yourself, within your own department.');
  const final = [...new Set([...unique, ...kept])];
  await tx.userCustomRole.deleteMany({ where: { userId } });
  if (final.length) await tx.userCustomRole.createMany({ data: final.map((customRoleId) => ({ tenantId, userId, customRoleId })) });
  forgetCustomPermissions(tenantId);
}

/** Whether a person may still use the app (active, not restricted). Cached 30 s; HR changes clear it. */
const active = new Map<string, { at: number; ok: boolean }>();
export async function stillActive(tenantId: string, userId: string): Promise<boolean> {
  const hit = active.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  const u = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { status: true, processingRestrictedAt: true, anonymizedAt: true } }));
  const ok = !!u && u.status === 'ACTIVE' && !u.processingRestrictedAt && !u.anonymizedAt;
  active.set(userId, { at: Date.now(), ok });
  return ok;
}
export function forgetActive(userId?: string): void {
  if (userId) active.delete(userId);
  else active.clear();
}
