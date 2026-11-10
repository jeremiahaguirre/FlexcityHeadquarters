/**
 * Department scope for supervisors and managers made from custom roles.
 * A scoped lead sees and acts on people who hold one of the role's positions,
 * and shifts for those positions at the role's facilities. null = everywhere.
 */
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../auth/middleware.js';
import type { Tx } from '../../lib/db.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { RoleActor, Scope } from './customRoles.js';

export const actorOf = (a: AuthContext): RoleActor => ({ permissions: a.permissions, scope: a.scope });

/** Prisma filter: people in scope. */
export function peopleWhere(s: Scope): Prisma.UserWhereInput {
  if (!s || !s.positionIds.length) return {};
  const byRole: Prisma.UserWhereInput[] = s.accessRoles?.length ? [{ roles: { hasSome: s.accessRoles as never[] } }] : [];
  return { AND: [{ OR: [{ positions: { some: { positionId: { in: s.positionIds } } } }, ...byRole] }] };
}

/** Filter for anything placed at a facility for a position (lesson classes, …). */
export function placeWhere(s: Scope): { positionId?: { in: string[] }; facilityId?: { in: string[] } } {
  if (!s) return {};
  return { ...(s.positionIds.length ? { positionId: { in: s.positionIds } } : {}), ...(s.facilityIds.length ? { facilityId: { in: s.facilityIds } } : {}) };
}

/** Facilities a lead is limited to, or null for every facility. */
export const facilitiesOf = (s: Scope): string[] | null => (s && s.facilityIds.length ? s.facilityIds : null);

/** Prisma filter: shifts in scope. */
export function shiftsWhere(s: Scope): Prisma.ShiftWhereInput {
  if (!s) return {};
  return { ...(s.positionIds.length ? { positionId: { in: s.positionIds } } : {}), ...(s.facilityIds.length ? { facilityId: { in: s.facilityIds } } : {}) };
}

export function shiftInScope(s: Scope, shift: { positionId: string; facilityId: string }): boolean {
  return !s || ((!s.positionIds.length || s.positionIds.includes(shift.positionId)) && (!s.facilityIds.length || s.facilityIds.includes(shift.facilityId)));
}

export async function userInScope(tx: Tx, s: Scope, userId: string): Promise<boolean> {
  if (!s || !s.positionIds.length) return true;
  return (await tx.user.count({ where: { id: userId, ...peopleWhere(s) } })) > 0;
}

export async function assertUserInScope(tx: Tx, a: AuthContext, userId: string) {
  if (!(await userInScope(tx, a.scope, userId))) throw forbidden('This person isn’t in your department.');
}

export function assertShiftInScope(a: AuthContext, shift: { positionId: string; facilityId: string }) {
  if (!shiftInScope(a.scope, shift)) throw forbidden('This shift isn’t in your department.');
}

/** The people a lead limited to some positions may see, or null for everyone. */
export async function peopleInScope(tx: Tx, s: Scope): Promise<Set<string> | null> {
  if (!s || !s.positionIds.length) return null;
  return new Set((await tx.user.findMany({ where: peopleWhere(s), select: { id: true } })).map((u) => u.id));
}

/** Incidents a limited lead may see: at their facilities, reported by people in their department. */
export async function incidentsWhere(tx: Tx, s: Scope): Promise<{ facilityId?: { in: string[] }; reportedById?: { in: string[] } }> {
  const people = await peopleInScope(tx, s);
  return { ...(s && s.facilityIds.length ? { facilityId: { in: s.facilityIds } } : {}), ...(people ? { reportedById: { in: [...people] } } : {}) };
}

/** A position outside a limited lead's department reads as not found. */
export function assertPositionInScope(a: AuthContext, positionId: string) {
  if (a.scope && a.scope.positionIds.length && !a.scope.positionIds.includes(positionId)) throw notFound('Position');
}

/**
 * HR records (discipline, notes, reliability, injuries, care, accommodations):
 * HR administrators see all of them. Every other supervisor or manager sees only
 * the ones they were directly involved in. Returns whose records to limit to.
 */
export const hrRecordsBy = (a: AuthContext): string | null => (a.roles.includes('HR_ADMIN') ? null : a.userId);
