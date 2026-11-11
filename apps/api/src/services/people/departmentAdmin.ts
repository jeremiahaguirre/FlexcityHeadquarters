/** Creating departments, putting positions in them and choosing who manages them (HR settings and the Dev console). */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { HttpError, conflict, notFound } from '../../lib/errors.js';
import { type Permission, ROLE_PERMISSIONS } from '../../auth/permissions.js';
import { SUPERVISORY, forgetCustomPermissions } from './customRoles.js';
import { forgetDepartments } from './departments.js';

export const departmentBody = z.object({
  name: z.string().trim().min(2).max(60),
  nameFr: z.string().trim().max(60).nullable().optional(),
  /** Its managers also see pool staff who don't hold a position yet. */
  aquatic: z.boolean().default(false),
  /** The positions in this department; positions left out move to no department. Any number. */
  positionIds: z.array(z.string().uuid()).max(5000).default([]),
  /** The supervisors and managers who run it; any number. Omit to leave them as they are. */
  managerIds: z.array(z.string().uuid()).max(1000).optional(),
});

/** Built-in roles that supervise people (HR sees every department already). */
const LEAD_ROLES = (Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>).filter((r) => r !== 'HR_ADMIN' && ROLE_PERMISSIONS[r].some((p) => SUPERVISORY.has(p)));
const isManagementRole = (perms: string[]) => perms.some((p) => SUPERVISORY.has(p as Permission));

/** Everyone who can be chosen to run a department: people holding a supervisor, manager or lead role. */
async function managerCandidates(tx: Tx) {
  const assigned = (await tx.userCustomRole.findMany({ include: { customRole: { select: { name: true, nameFr: true, permissions: true } } } })).filter((r) => isManagementRole(r.customRole.permissions));
  const users = await tx.user.findMany({
    where: { status: 'ACTIVE', anonymizedAt: null, OR: [{ roles: { hasSome: LEAD_ROLES } }, { id: { in: [...new Set(assigned.map((r) => r.userId))] } }] },
    select: { id: true, firstName: true, lastName: true, roles: true },
  });
  const people = new Map<string, { id: string; name: string; roles: string[]; customRoles: Array<{ name: string; nameFr: string | null }> }>();
  for (const u of users) {
    if (u.roles.includes('HR_ADMIN')) continue; // HR already sees every department
    people.set(u.id, { id: u.id, name: `${u.firstName} ${u.lastName}`, roles: u.roles.filter((r) => LEAD_ROLES.includes(r as never)), customRoles: assigned.filter((r) => r.userId === u.id).map((r) => ({ name: r.customRole.name, nameFr: r.customRole.nameFr })) });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDepartments(tx: Tx) {
  const [departments, positions, managers, candidates] = await Promise.all([
    tx.department.findMany({ orderBy: [{ aquatic: 'desc' }, { name: 'asc' }] }),
    tx.position.findMany({ select: { id: true, name: true, nameFr: true, departmentId: true, _count: { select: { qualifiedUsers: true } } }, orderBy: { name: 'asc' } }),
    tx.departmentManager.findMany({ select: { departmentId: true, userId: true } }),
    managerCandidates(tx),
  ]);
  const view = (p: (typeof positions)[number]) => ({ id: p.id, name: p.name, nameFr: p.nameFr, staff: p._count.qualifiedUsers });
  return {
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      nameFr: d.nameFr,
      aquatic: d.aquatic,
      positions: positions.filter((p) => p.departmentId === d.id).map(view),
      managerIds: managers.filter((m) => m.departmentId === d.id).map((m) => m.userId),
    })),
    unassigned: positions.filter((p) => !p.departmentId).map(view),
    /** Every supervisor and manager in the city, for the "Managed by" dropdown. */
    managerOptions: candidates,
  };
}

/** Sets who runs a department: any number of the city's supervisors and managers. */
async function setManagers(tx: Tx, tenantId: string, departmentId: string, wanted: string[]) {
  const ids = [...new Set(wanted)];
  const allowed = new Set((await managerCandidates(tx)).map((c) => c.id));
  const bad = ids.filter((id) => !allowed.has(id));
  if (bad.length) throw new HttpError(400, 'NOT_A_MANAGER', 'Only supervisors and managers can run a department. Give the person a supervisor, manager or lead role first.', { userIds: bad });
  await tx.departmentManager.deleteMany({ where: { departmentId, userId: { notIn: ids } } });
  const existing = new Set((await tx.departmentManager.findMany({ where: { departmentId }, select: { userId: true } })).map((m) => m.userId));
  const add = ids.filter((id) => !existing.has(id));
  if (add.length) await tx.departmentManager.createMany({ data: add.map((userId) => ({ tenantId, departmentId, userId })) });
}

export async function saveDepartment(tx: Tx, tenantId: string, id: string | null, body: z.infer<typeof departmentBody>) {
  const clash = await tx.department.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict('DEPARTMENT_EXISTS', 'There is already a department with that name.');
  const positionIds = [...new Set(body.positionIds)];
  if ((await tx.position.count({ where: { id: { in: positionIds } } })) !== positionIds.length) throw new HttpError(400, 'UNKNOWN_POSITION', 'Unknown position.');
  const data = { name: body.name, nameFr: body.nameFr ?? null, aquatic: body.aquatic };
  if (id && !(await tx.department.findUnique({ where: { id } }))) throw notFound('Department');
  const d = id ? await tx.department.update({ where: { id }, data }) : await tx.department.create({ data: { ...data, tenantId } });
  // A position belongs to one department: listing it here moves it from any other.
  await tx.position.updateMany({ where: { departmentId: d.id, id: { notIn: positionIds } }, data: { departmentId: null } });
  if (positionIds.length) await tx.position.updateMany({ where: { id: { in: positionIds } }, data: { departmentId: d.id } });
  if (body.managerIds) await setManagers(tx, tenantId, d.id, body.managerIds);
  await forget(tenantId, tx);
  return d;
}

export async function deleteDepartment(tx: Tx, tenantId: string, id: string) {
  if (!(await tx.department.findUnique({ where: { id } }))) throw notFound('Department');
  // Roles limited to it lose it. A role left with no department reaches no one, never the whole city.
  for (const r of await tx.customRole.findMany({ where: { scopeDepartmentIds: { has: id } } })) {
    await tx.customRole.update({ where: { id: r.id }, data: { scopeDepartmentIds: r.scopeDepartmentIds.filter((d) => d !== id) } });
  }
  await tx.department.delete({ where: { id } });
  await forget(tenantId, tx);
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

/** Given the change's transaction, other API processes drop their copies when it commits. */
export async function forget(tenantId: string, tx?: Tx) {
  await forgetDepartments(tenantId, tx);
  await forgetCustomPermissions(tenantId, tx);
}
