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
  fleet: ['fleet.inspect', 'fleet.manage'],
  aquatics: ['lessons.teach', 'ops.chemical.record', 'ops.chemical.signoff', 'ops.pool.close', 'ops.status.read', 'ops.page_head_guard', 'deck.rotate', 'ops.configure'],
  lead: ['training.manage', 'users.read', 'users.scheduling', 'schedule.write', 'schedule.assist', 'shiftboard.approve', 'shiftboard.assign_emergency', 'timeoff.approve', 'timeclock.review', 'certs.verify', 'lonework.monitor', 'onboarding.lead', 'overtime.manage', 'coverage.manage'],
  manager: ['documents.manage', 'accounting.manage', 'performance.manage', 'grievances.manage', 'injury.manage', 'reliability.read', 'reliability.write', 'discipline.read', 'discipline.write', 'incidents.read', 'care.manage', 'compliance.report', 'payroll.export', 'positions.manage', 'jobs.manage', 'roles.manage'],
  admin: ['payroll.approve', 'benefits.manage', 'leave.manage', 'users.write', 'users.privacy', 'audit.read', 'onboarding.hr', 'onboarding.configure', 'accommodation.manage', 'tenant.configure', 'billing.manage'],
} as const satisfies Record<string, readonly Permission[]>;

export const ALLOWED_CUSTOM_PERMISSIONS: ReadonlySet<Permission> = new Set(Object.values(CUSTOM_ROLE_PERMISSIONS).flat());
export const isAllowedCustomPermission = (p: string): p is Permission => ALLOWED_CUSTOM_PERMISSIONS.has(p as Permission);

/** Capabilities that act on other people or their shifts: these follow a role's department. */
export const SUPERVISORY: ReadonlySet<Permission> = new Set([...CUSTOM_ROLE_PERMISSIONS.lead, ...CUSTOM_ROLE_PERMISSIONS.manager, ...CUSTOM_ROLE_PERMISSIONS.admin, 'winter.callout', 'winter.records', 'winter.manage', 'fleet.manage']);

/**
 * null = the whole organization. Otherwise people who hold one of the positions
 * (or, for the built-in aquatic roles, one of `accessRoles`), and shifts for those
 * positions at the facilities (empty facilityIds = every facility).
 */
export type Scope = { positionIds: string[]; facilityIds: string[]; accessRoles?: string[] } | null;

/** Stands in for "no positions at all", since an empty list means every position. */
export const NO_POSITION = '00000000-0000-0000-0000-000000000000';
/** People an aquatic supervisor sees even before they hold a position. */
export const AQUATIC_ACCESS_ROLES = ['STAFF', 'HEAD_LIFEGUARD', 'FRONT_DESK'];

interface CustomAccess { perms: Set<Permission>; roles: Array<{ perms: Permission[]; positionIds: string[]; facilityIds: string[] }> }
const cache = new Map<string, { at: number } & CustomAccess>();
const TTL_MS = 30_000;

/** A person's custom roles: their capabilities and departments (cached briefly per person). */
export async function customAccess(tenantId: string, userId: string): Promise<CustomAccess> {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const { rows, inDepartment } = await withTenant(tenantId, async (tx) => {
    const rows = await tx.userCustomRole.findMany({ where: { userId }, include: { customRole: { select: { permissions: true, scopePositionIds: true, scopeFacilityIds: true, scopeDepartmentIds: true } } } });
    const departments = [...new Set(rows.flatMap((r) => r.customRole.scopeDepartmentIds))];
    const positions = departments.length ? await tx.position.findMany({ where: { departmentId: { in: departments } }, select: { id: true, departmentId: true } }) : [];
    return { rows, inDepartment: (ids: string[]) => positions.filter((p) => ids.includes(p.departmentId!)).map((p) => p.id) };
  });
  // Filter again on the way out: the catalogue is the rule, whatever is stored.
  // A role limited to departments reaches every position in them, including new ones.
  const roles = rows.map((r) => {
    const c = r.customRole;
    const fromDepartments = c.scopeDepartmentIds.length ? inDepartment(c.scopeDepartmentIds) : [];
    const positionIds = c.scopeDepartmentIds.length ? [...new Set([...c.scopePositionIds, ...fromDepartments, NO_POSITION])] : c.scopePositionIds;
    return { perms: c.permissions.filter(isAllowedCustomPermission), positionIds, facilityIds: c.scopeFacilityIds };
  });
  const entry = { at: Date.now(), perms: new Set(roles.flatMap((r) => r.perms)), roles };
  cache.set(key, entry);
  return entry;
}

export async function customPermissions(tenantId: string, userId: string): Promise<Set<Permission>> {
  return (await customAccess(tenantId, userId)).perms;
}

/**
 * Where a person's supervisory capabilities reach.
 * - HR administrators: every department.
 * - Everyone else who supervises or manages: the departments HR chose them to
 *   manage, plus the departments, positions or facilities their custom roles are
 *   limited to. With none of those they reach no one; only HR sees all departments.
 * - A city that hasn't set up departments yet keeps the old behaviour: built-in
 *   leads and unlimited custom roles reach everyone.
 */
export function scopeOf(builtIn: ReadonlySet<Permission>, access: CustomAccess, ctx: { roles?: readonly string[]; managed?: { hasDepartments: boolean; positionIds: string[]; aquatic: boolean } } = {}): Scope {
  if (ctx.roles?.includes('HR_ADMIN')) return null;
  const builtInLead = [...builtIn].some((p) => SUPERVISORY.has(p));
  const leads = access.roles.filter((r) => r.perms.some((p) => SUPERVISORY.has(p)));
  if (!builtInLead && !leads.length) return null; // supervises no one: nothing to limit
  const limited = leads.filter((r) => r.positionIds.length || r.facilityIds.length);
  if (!ctx.managed?.hasDepartments) {
    if (builtInLead || limited.length < leads.length) return null;
    return { positionIds: [...new Set(limited.flatMap((r) => r.positionIds))], facilityIds: [...new Set(limited.flatMap((r) => r.facilityIds))] };
  }
  const managed = ctx.managed;
  const positionIds = [...new Set([...managed.positionIds, ...limited.flatMap((r) => r.positionIds)])];
  // A facility limit applies only when facilities are all the person was given.
  const facilityIds = !positionIds.length ? [...new Set(limited.flatMap((r) => r.facilityIds))] : [];
  return {
    positionIds: positionIds.length || facilityIds.length ? positionIds : [NO_POSITION],
    facilityIds,
    ...(managed.aquatic ? { accessRoles: AQUATIC_ACCESS_ROLES } : {}),
  };
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
  // Room for every capability in the catalogue, however it grows.
  permissions: z.array(z.string()).min(1).max(500),
  scopePositionIds: z.array(z.string().uuid()).max(2000).optional(),
  scopeFacilityIds: z.array(z.string().uuid()).max(2000).optional(),
  scopeDepartmentIds: z.array(z.string().uuid()).max(2000).optional(),
});
export type CustomRoleInput = z.infer<typeof customRoleBody>;

type StoredRole = { permissions: string[]; scopePositionIds: string[]; scopeFacilityIds: string[]; scopeDepartmentIds?: string[] };

/** Each department's positions, for turning a department-limited role into its positions. */
export async function departmentPositions(tx: Tx): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const p of await tx.position.findMany({ where: { departmentId: { not: null } }, select: { id: true, departmentId: true } })) map.set(p.departmentId!, [...(map.get(p.departmentId!) ?? []), p.id]);
  return map;
}

/** A role's reach as positions: its own positions plus every position in its departments. */
export function effective(role: StoredRole, departments: Map<string, string[]>) {
  const fromDepartments = (role.scopeDepartmentIds ?? []).flatMap((d) => departments.get(d) ?? []);
  return { permissions: role.permissions, scopePositionIds: [...new Set([...role.scopePositionIds, ...fromDepartments])], scopeFacilityIds: role.scopeFacilityIds };
}

export async function saveCustomRole(tx: Tx, tenantId: string, id: string | null, body: CustomRoleInput, actor: RoleActor | null = null) {
  const bad = body.permissions.filter((p) => !isAllowedCustomPermission(p));
  if (bad.length) throw new HttpError(400, 'PERMISSION_NOT_ALLOWED', `A custom role can't include: ${bad.join(', ')}.`, { permissions: bad });
  const scopePositionIds = [...new Set(body.scopePositionIds ?? [])];
  const scopeFacilityIds = [...new Set(body.scopeFacilityIds ?? [])];
  const scopeDepartmentIds = [...new Set(body.scopeDepartmentIds ?? [])];
  if ((await tx.department.count({ where: { id: { in: scopeDepartmentIds } } })) !== scopeDepartmentIds.length) throw new HttpError(400, 'UNKNOWN_DEPARTMENT', 'Unknown department.');
  if ((await tx.position.count({ where: { id: { in: scopePositionIds } } })) !== scopePositionIds.length) throw new HttpError(400, 'UNKNOWN_POSITION', 'Unknown position.');
  if ((await tx.facility.count({ where: { id: { in: scopeFacilityIds } } })) !== scopeFacilityIds.length) throw new HttpError(400, 'UNKNOWN_FACILITY', 'Unknown facility.');
  const departments = await departmentPositions(tx);
  const proposed = effective({ permissions: body.permissions, scopePositionIds, scopeFacilityIds, scopeDepartmentIds }, departments);
  if (scopeDepartmentIds.length && actor?.scope && !proposed.scopePositionIds.length) throw forbidden('Those departments have no positions yet.');
  if (!covers(actor, proposed)) throw forbidden('You can only give a role capabilities you have yourself, within your own department.');
  if (id) {
    const existing = await tx.customRole.findUnique({ where: { id } });
    if (existing && !covers(actor, effective(existing, departments))) throw forbidden('This role has capabilities or a department beyond yours.');
  }
  const clash = await tx.customRole.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict('ROLE_EXISTS', 'There is already a role with that name.');
  const data = { name: body.name, nameFr: body.nameFr ?? null, description: body.description ?? null, permissions: [...new Set(body.permissions)], scopePositionIds, scopeFacilityIds, scopeDepartmentIds };
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
  if (existing && !covers(actor, effective(existing, await departmentPositions(tx)))) throw forbidden('This role has capabilities or a department beyond yours.');
  const gone = await tx.customRole.deleteMany({ where: { id } });
  if (!gone.count) throw notFound('Role');
  forgetCustomPermissions(tenantId);
}

export async function listCustomRoles(tx: Tx) {
  const roles = await tx.customRole.findMany({ include: { _count: { select: { members: true } } }, orderBy: { name: 'asc' } });
  const departments = await departmentPositions(tx);
  return roles.map((r) => ({ id: r.id, name: r.name, nameFr: r.nameFr, description: r.description, permissions: r.permissions, scopePositionIds: r.scopePositionIds, scopeFacilityIds: r.scopeFacilityIds, scopeDepartmentIds: r.scopeDepartmentIds, reach: effective(r, departments), members: r._count.members }));
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
  const departments = await departmentPositions(tx);
  const kept = held.filter((h) => !covers(actor, effective(h.customRole, departments))).map((h) => h.customRoleId);
  const added = wanted.filter((r) => !held.some((h) => h.customRoleId === r.id));
  if (added.some((r) => !covers(actor, effective(r, departments)))) throw forbidden('You can only give roles with capabilities you have yourself, within your own department.');
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
