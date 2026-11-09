/**
 * Department scope for supervisors and managers made from custom roles.
 * A scoped lead sees and acts on people who hold one of the role's positions,
 * and shifts for those positions at the role's facilities. null = everywhere.
 */
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../auth/middleware.js';
import type { Tx } from '../../lib/db.js';
import { forbidden } from '../../lib/errors.js';
import type { RoleActor, Scope } from './customRoles.js';

export const actorOf = (a: AuthContext): RoleActor => ({ permissions: a.permissions, scope: a.scope });

/** Prisma filter: people in scope. */
export function peopleWhere(s: Scope): Prisma.UserWhereInput {
  return !s || !s.positionIds.length ? {} : { positions: { some: { positionId: { in: s.positionIds } } } };
}

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
  return (await tx.userPosition.count({ where: { userId, positionId: { in: s.positionIds } } })) > 0;
}

export async function assertUserInScope(tx: Tx, a: AuthContext, userId: string) {
  if (!(await userInScope(tx, a.scope, userId))) throw forbidden('This person isn’t in your department.');
}

export function assertShiftInScope(a: AuthContext, shift: { positionId: string; facilityId: string }) {
  if (!shiftInScope(a.scope, shift)) throw forbidden('This shift isn’t in your department.');
}
