/** Creating departments, putting positions in them and choosing who manages them (HR settings and the Dev console). */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { HttpError, conflict, notFound } from '../../lib/errors.js';
import { type Permission } from '../../auth/permissions.js';
import { SUPERVISORY, forgetCustomPermissions } from './customRoles.js';
import { forgetDepartments } from './departments.js';

/** The built-in aquatic roles, offered as one management option: they follow the aquatics flag. */
export const AQUATIC_MANAGERS = 'builtin:aquatic';

export const departmentBody = z.object({
  name: z.string().trim().min(2).max(60),
  nameFr: z.string().trim().max(60).nullable().optional(),
  aquatic: z.boolean().default(false),
  /** The positions in this department; positions left out move to no department. Any number. */
  positionIds: z.array(z.string().uuid()).max(5000).default([]),
  /**
   * Custom management roles (supervisors, managers, leads) that manage this
   * department. Omit to leave them as they are.
   */
  managerRoleIds: z.array(z.union([z.literal(AQUATIC_MANAGERS), z.string().uuid()])).max(500).optional(),
});


const isManagement = (perms: string[]) => perms.some((p) => SUPERVISORY.has(p as Permission));

export async function listDepartments(tx: Tx) {
  const [departments, positions, roles] = await Promise.all([
    tx.department.findMany({ orderBy: [{ aquatic: 'desc' }, { name: 'asc' }] }),
    tx.position.findMany({ select: { id: true, name: true, nameFr: true, departmentId: true, _count: { select: { qualifiedUsers: true } } }, orderBy: { name: 'asc' } }),
    tx.customRole.findMany({ select: { id: true, name: true, nameFr: true, permissions: true, scopeDepartmentIds: true, scopePositionIds: true, scopeFacilityIds: true }, orderBy: { name: 'asc' } }),
  ]);
  const view = (p: (typeof positions)[number]) => ({ id: p.id, name: p.name, nameFr: p.nameFr, staff: p._count.qualifiedUsers });
  const managers = roles.filter((r) => isManagement(r.permissions));
  return {
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      nameFr: d.nameFr,
      aquatic: d.aquatic,
      positions: positions.filter((p) => p.departmentId === d.id).map(view),
      managerRoleIds: managers.filter((r) => r.scopeDepartmentIds.includes(d.id)).map((r) => r.id),
    })),
    unassigned: positions.filter((p) => !p.departmentId).map(view),
    /** Every management role a department can be given, built-in aquatic leads first. */
    managerOptions: [
      { id: AQUATIC_MANAGERS, name: 'Aquatic supervisors and head lifeguards', nameFr: 'Superviseurs aquatiques et chefs sauveteurs', builtIn: true, wholeCity: false },
      ...managers.map((r) => ({ id: r.id, name: r.name, nameFr: r.nameFr, builtIn: false, wholeCity: !r.scopeDepartmentIds.length && !r.scopePositionIds.length && !r.scopeFacilityIds.length })),
    ],
  };
}

/** A role left with no department, position or facility would reach the whole city: never by accident. */
function assertStillLimited(role: { name: string; scopeDepartmentIds: string[]; scopePositionIds: string[]; scopeFacilityIds: string[] }, wasLimited: boolean) {
  if (wasLimited && !role.scopeDepartmentIds.length && !role.scopePositionIds.length && !role.scopeFacilityIds.length) {
    throw new HttpError(409, 'ROLE_WOULD_WIDEN', `“${role.name}” manages only this department. Give it another department first, or change the role itself, so it doesn’t end up reaching the whole city.`, { role: role.name });
  }
}

/** Sets which custom management roles manage a department. */
async function setManagers(tx: Tx, departmentId: string, wanted: string[]) {
  const ids = [...new Set(wanted.filter((x) => x !== AQUATIC_MANAGERS))];
  const roles = await tx.customRole.findMany({ where: { id: { in: ids } } });
  if (roles.length !== ids.length) throw new HttpError(400, 'UNKNOWN_ROLE', 'Unknown role.');
  const notManagement = roles.filter((r) => !isManagement(r.permissions));
  if (notManagement.length) throw new HttpError(400, 'NOT_A_MANAGEMENT_ROLE', `${notManagement.map((r) => r.name).join(', ')} can’t manage a department: give it supervisor, manager or lead capabilities first.`);
  for (const r of roles) {
    if (!r.scopeDepartmentIds.includes(departmentId)) await tx.customRole.update({ where: { id: r.id }, data: { scopeDepartmentIds: [...r.scopeDepartmentIds, departmentId] } });
  }
  for (const r of await tx.customRole.findMany({ where: { scopeDepartmentIds: { has: departmentId }, id: { notIn: ids } } })) {
    const next = { ...r, scopeDepartmentIds: r.scopeDepartmentIds.filter((d) => d !== departmentId) };
    assertStillLimited(next, true);
    await tx.customRole.update({ where: { id: r.id }, data: { scopeDepartmentIds: next.scopeDepartmentIds } });
  }
}

export async function saveDepartment(tx: Tx, tenantId: string, id: string | null, body: z.infer<typeof departmentBody>) {
  const clash = await tx.department.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict('DEPARTMENT_EXISTS', 'There is already a department with that name.');
  const positionIds = [...new Set(body.positionIds)];
  if ((await tx.position.count({ where: { id: { in: positionIds } } })) !== positionIds.length) throw new HttpError(400, 'UNKNOWN_POSITION', 'Unknown position.');
  // Choosing the built-in aquatic leads as managers is the same as marking it an aquatics department.
  const aquatic = body.managerRoleIds ? body.managerRoleIds.includes(AQUATIC_MANAGERS) || body.aquatic : body.aquatic;
  const data = { name: body.name, nameFr: body.nameFr ?? null, aquatic };
  if (id && !(await tx.department.findUnique({ where: { id } }))) throw notFound('Department');
  const d = id ? await tx.department.update({ where: { id }, data }) : await tx.department.create({ data: { ...data, tenantId } });
  // A position belongs to one department: listing it here moves it from any other.
  await tx.position.updateMany({ where: { departmentId: d.id, id: { notIn: positionIds } }, data: { departmentId: null } });
  if (positionIds.length) await tx.position.updateMany({ where: { id: { in: positionIds } }, data: { departmentId: d.id } });
  if (body.managerRoleIds) await setManagers(tx, d.id, body.managerRoleIds);
  forget(tenantId);
  return d;
}

export async function deleteDepartment(tx: Tx, tenantId: string, id: string) {
  if (!(await tx.department.findUnique({ where: { id } }))) throw notFound('Department');
  // Roles that managed it lose it; one that managed nothing else must not widen to the whole city.
  for (const r of await tx.customRole.findMany({ where: { scopeDepartmentIds: { has: id } } })) {
    const next = { ...r, scopeDepartmentIds: r.scopeDepartmentIds.filter((d) => d !== id) };
    assertStillLimited(next, true);
    await tx.customRole.update({ where: { id: r.id }, data: { scopeDepartmentIds: next.scopeDepartmentIds } });
  }
  await tx.department.delete({ where: { id } });
  forget(tenantId);
}

/** Checks a department id belongs to this organization (row-level security hides others). */
export async function assertDepartment(tx: Tx, id: string | null | undefined) {
  if (id && !(await tx.department.findUnique({ where: { id } }))) throw new HttpError(400, 'UNKNOWN_DEPARTMENT', 'Unknown department.');
}

export const departmentQuery = z.union([z.literal('none'), z.string().uuid()]).optional();

/** Combines person filters without one overwriting another's keys. */
export function allOf(...parts: Prisma.UserWhereInput[]): Prisma.UserWhereInput {
  const real = parts.filter((p) => Object.keys(p).length);
  return real.length ? { AND: real } : {};
}

/** People in a department, or with no department ("none"), for HR's department tabs. */
export function departmentFilter(department: string | undefined): Prisma.UserWhereInput {
  if (!department) return {};
  if (department === 'none') return { positions: { none: { position: { departmentId: { not: null } } } } };
  return { positions: { some: { position: { departmentId: department } } } };
}

export function forget(tenantId: string) {
  forgetDepartments(tenantId);
  forgetCustomPermissions(tenantId);
}
