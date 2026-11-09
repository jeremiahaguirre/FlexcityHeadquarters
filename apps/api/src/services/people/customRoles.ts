/**
 * Roles an organization defines for its own non-aquatic jobs. A custom role can
 * only grant permissions from this list: everyday work, the shift board, and
 * lead duties. Pool deck, incidents, lessons, payroll, HR records and settings
 * are never available to a custom role, whoever creates it.
 */
import type { Permission } from '../../auth/permissions.js';
import { z } from 'zod';
import { type Tx, withTenant } from '../../lib/db.js';
import { HttpError, conflict, notFound } from '../../lib/errors.js';

export const CUSTOM_ROLE_PERMISSIONS = {
  everyday: ['schedule.read', 'shifts.self', 'timeclock.punch', 'timeoff.self', 'availability.self'],
  shiftBoard: ['shiftboard.claim', 'shiftboard.post'],
  lead: ['users.read', 'users.scheduling', 'schedule.write', 'shiftboard.approve', 'timeoff.approve', 'timeclock.review', 'certs.verify'],
} as const satisfies Record<string, readonly Permission[]>;

export const ALLOWED_CUSTOM_PERMISSIONS: ReadonlySet<Permission> = new Set(Object.values(CUSTOM_ROLE_PERMISSIONS).flat());

export const isAllowedCustomPermission = (p: string): p is Permission => ALLOWED_CUSTOM_PERMISSIONS.has(p as Permission);

const cache = new Map<string, { at: number; perms: Set<Permission> }>();
const TTL_MS = 30_000;

/** Union of the permissions of a person's custom roles (cached briefly per person). */
export async function customPermissions(tenantId: string, userId: string): Promise<Set<Permission>> {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.perms;
  const rows = await withTenant(tenantId, (tx) => tx.userCustomRole.findMany({ where: { userId }, include: { customRole: { select: { permissions: true } } } }));
  // Filter again on the way out: the allow-list is the rule, whatever is stored.
  const perms = new Set(rows.flatMap((r) => r.customRole.permissions).filter(isAllowedCustomPermission));
  cache.set(key, { at: Date.now(), perms });
  return perms;
}

export function forgetCustomPermissions(tenantId?: string): void {
  if (!tenantId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}

// ------------------------------------------------------- Create / change / remove

export const customRoleBody = z.object({
  name: z.string().trim().min(2).max(60),
  nameFr: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.string()).min(1).max(30),
});
export type CustomRoleInput = z.infer<typeof customRoleBody>;

export async function saveCustomRole(tx: Tx, tenantId: string, id: string | null, body: CustomRoleInput) {
  const bad = body.permissions.filter((p) => !isAllowedCustomPermission(p));
  if (bad.length) throw new HttpError(400, 'PERMISSION_NOT_ALLOWED', `A custom role can't include: ${bad.join(', ')}.`, { permissions: bad });
  const clash = await tx.customRole.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict('ROLE_EXISTS', 'There is already a role with that name.');
  const data = { name: body.name, nameFr: body.nameFr ?? null, description: body.description ?? null, permissions: [...new Set(body.permissions)] };
  if (id) {
    if (!(await tx.customRole.findUnique({ where: { id } }))) throw notFound('Role');
    await tx.customRole.update({ where: { id }, data });
  }
  const role = id ? await tx.customRole.findUniqueOrThrow({ where: { id } }) : await tx.customRole.create({ data: { ...data, tenantId } });
  forgetCustomPermissions(tenantId);
  return role;
}

export async function deleteCustomRole(tx: Tx, tenantId: string, id: string) {
  const gone = await tx.customRole.deleteMany({ where: { id } });
  if (!gone.count) throw notFound('Role');
  forgetCustomPermissions(tenantId);
}

export async function listCustomRoles(tx: Tx) {
  const roles = await tx.customRole.findMany({ include: { _count: { select: { members: true } } }, orderBy: { name: 'asc' } });
  return roles.map((r) => ({ id: r.id, name: r.name, nameFr: r.nameFr, description: r.description, permissions: r.permissions, members: r._count.members }));
}

/** Replaces a person's custom roles; ids must be this organization's roles (row-level security hides others). */
export async function setUserCustomRoles(tx: Tx, tenantId: string, userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if ((await tx.customRole.count({ where: { id: { in: unique } } })) !== unique.length) throw new HttpError(400, 'UNKNOWN_ROLE', 'Unknown role.');
  await tx.userCustomRole.deleteMany({ where: { userId } });
  if (unique.length) await tx.userCustomRole.createMany({ data: unique.map((customRoleId) => ({ tenantId, userId, customRoleId })) });
  forgetCustomPermissions(tenantId);
}
