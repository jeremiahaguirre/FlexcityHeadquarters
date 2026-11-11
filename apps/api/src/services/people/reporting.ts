/**
 * Reporting lines: who reports to whom.
 *
 * A person's manager is the one HR (or their department's manager) set on their record; with
 * none set, it is their department's manager (services/people/departments.ts), so a city that
 * only set up departments already has a chart. Only active people manage anyone: someone who
 * left falls out and their people move up to the department default.
 *
 * Reporting lines route approvals (approversFor) and default the reviewer of a performance
 * review. They never decide what anyone may see: that stays with permissions and department
 * scope (scope.ts).
 */
import type { AuthContext } from '../../auth/middleware.js';
import { accessOf } from '../../auth/middleware.js';
import type { Permission } from '../../auth/permissions.js';
import { z } from 'zod';
import { audit, type Tx } from '../../lib/db.js';
import { HttpError, forbidden, notFound } from '../../lib/errors.js';
import { usersWithPermission } from '../notifications/notifier.js';
import { userInScope } from './scope.js';

export type ManagerSource = 'set' | 'department';

export interface GraphPerson { id: string; active: boolean; reportsToId: string | null; departmentIds: string[] }
export interface GraphManager { departmentId: string; userId: string }

export interface ReportingGraph {
  /** Their effective managers: the one set on their record, else their departments' managers. */
  managers(id: string): string[];
  source(id: string): ManagerSource | null;
  /** The one manager the org chart draws them under. */
  parent(id: string): string | null;
  /** People whose effective managers include this person. */
  reports(id: string): string[];
  /** Is `below` somewhere under `above` (through any of their managers)? */
  isBelow(below: string, above: string): boolean;
  /** Change a set manager in this copy (for checking a batch of changes). */
  setManager(id: string, managerId: string | null): void;
}

/** Pure: the reporting graph from people and department managers. */
export function buildGraph(people: GraphPerson[], deptManagers: GraphManager[]): ReportingGraph {
  const byId = new Map(people.map((p) => [p.id, { ...p }]));
  const active = (id: string | null | undefined): id is string => !!id && !!byId.get(id)?.active;
  const managersOf = new Map<string, string[]>();
  for (const m of deptManagers) {
    const list = managersOf.get(m.departmentId) ?? [];
    if (!list.includes(m.userId)) list.push(m.userId);
    managersOf.set(m.departmentId, list);
  }
  let reportsCache: Map<string, string[]> | null = null;

  const deptDefault = (id: string): string[] => {
    const p = byId.get(id);
    if (!p) return [];
    const out: string[] = [];
    for (const d of p.departmentIds) {
      const ms = managersOf.get(d) ?? [];
      // A department's own managers don't report to each other by default.
      if (ms.includes(id)) continue;
      for (const m of ms) if (m !== id && active(m) && !out.includes(m)) out.push(m);
    }
    return out;
  };
  const managers = (id: string): string[] => {
    const p = byId.get(id);
    if (!p) return [];
    if (active(p.reportsToId) && p.reportsToId !== id) return [p.reportsToId];
    return deptDefault(id);
  };
  const g: ReportingGraph = {
    managers,
    source: (id) => {
      const p = byId.get(id);
      if (p && active(p.reportsToId) && p.reportsToId !== id) return 'set';
      return deptDefault(id).length ? 'department' : null;
    },
    parent: (id) => managers(id)[0] ?? null,
    reports: (id) => {
      if (!reportsCache) {
        reportsCache = new Map();
        for (const p of byId.values()) {
          if (!p.active) continue;
          for (const m of managers(p.id)) reportsCache.set(m, [...(reportsCache.get(m) ?? []), p.id]);
        }
      }
      return reportsCache.get(id) ?? [];
    },
    isBelow: (below, above) => {
      // Walk up from `below` through every manager; reaching `above` means it is underneath.
      const seen = new Set<string>();
      const queue = [below];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const m of managers(cur)) {
          if (m === above) return true;
          if (!seen.has(m)) {
            seen.add(m);
            queue.push(m);
          }
        }
      }
      return false;
    },
    setManager: (id, managerId) => {
      const p = byId.get(id);
      if (p) p.reportsToId = managerId;
      reportsCache = null;
    },
  };
  return g;
}

/** The organization's reporting graph (everyone not yet anonymized), in the caller's tenant transaction. */
export async function loadGraph(tx: Tx): Promise<ReportingGraph> {
  const [people, managers] = await Promise.all([
    tx.user.findMany({ where: { anonymizedAt: null }, select: { id: true, status: true, reportsToId: true, positions: { select: { position: { select: { departmentId: true } } } } } }),
    tx.departmentManager.findMany({ select: { departmentId: true, userId: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return buildGraph(
    people.map((p) => ({ id: p.id, active: p.status === 'ACTIVE', reportsToId: p.reportsToId, departmentIds: [...new Set(p.positions.map((x) => x.position.departmentId).filter((d): d is string => !!d))] })),
    managers,
  );
}

/** Pure: parents for a tree of these people, dropping links that would loop or leave the set. */
export function treeParents(ids: string[], parentOf: (id: string) => string | null): Map<string, string | null> {
  const inSet = new Set(ids);
  const out = new Map<string, string | null>();
  for (const id of ids) {
    const p = parentOf(id);
    out.set(id, p && inSet.has(p) && p !== id ? p : null);
  }
  // Break any loop (possible only through department defaults): the first one found becomes a root.
  const state = new Map<string, 1 | 2>();
  for (const start of ids) {
    const path: string[] = [];
    let cur: string | null = start;
    while (cur && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      cur = out.get(cur) ?? null;
    }
    if (cur && state.get(cur) === 1) out.set(path[path.length - 1]!, null);
    for (const p of path) state.set(p, 2);
  }
  return out;
}

// ------------------------------------------------------------------ Editing

/** HR (users.write) for anyone in their scope; a department's manager for its people. */
export async function canSetManager(tx: Tx, a: AuthContext, targetId: string): Promise<boolean> {
  if (a.permissions.has('users.write')) return userInScope(tx, a.scope, targetId);
  const target = await tx.user.findUnique({ where: { id: targetId }, select: { positions: { select: { position: { select: { departmentId: true } } } } } });
  const departments = [...new Set((target?.positions ?? []).map((p) => p.position.departmentId).filter((d): d is string => !!d))];
  if (!departments.length) return false;
  return (await tx.departmentManager.count({ where: { userId: a.userId, departmentId: { in: departments } } })) > 0;
}

/**
 * Set (or clear, with null) the manager of several people, all or nothing.
 * Refuses: someone outside the organization (reads as not found), an inactive manager, anyone
 * reporting to themselves or to someone below them, and people the actor can't edit.
 */
export async function setManagers(tx: Tx, a: AuthContext | null, tenantId: string, userIds: string[], managerId: string | null): Promise<{ changed: number }> {
  const ids = [...new Set(userIds)];
  const people = await tx.user.findMany({ where: { id: { in: ids }, anonymizedAt: null }, select: { id: true, reportsToId: true } });
  if (people.length !== ids.length) throw notFound('Person');
  if (managerId) {
    // RLS: another organization's person isn't there to find.
    const m = await tx.user.findFirst({ where: { id: managerId, anonymizedAt: null }, select: { status: true } });
    if (!m) throw notFound('Manager');
    if (m.status !== 'ACTIVE') throw new HttpError(400, 'MANAGER_INACTIVE', 'Choose someone who still works here.');
    // Outside HR, a manager picks from the people they can see (or themselves).
    if (a && !a.permissions.has('users.write') && managerId !== a.userId && !(await userInScope(tx, a.scope, managerId))) throw notFound('Manager');
  }
  if (a) for (const id of ids) if (!(await canSetManager(tx, a, id))) throw forbidden('You can set the manager only for people in a department you run.');
  const g = await loadGraph(tx);
  for (const id of ids) {
    if (managerId === id) throw new HttpError(400, 'MANAGER_SELF', 'Someone can’t report to themselves.');
    if (managerId && g.isBelow(managerId, id)) throw new HttpError(400, 'MANAGER_CYCLE', 'That person reports to them already (directly or further down), so they can’t be their manager.', { userId: id });
    g.setManager(id, managerId);
  }
  const changed = people.filter((p) => p.reportsToId !== managerId);
  if (!changed.length) return { changed: 0 };
  await tx.user.updateMany({ where: { id: { in: changed.map((p) => p.id) } }, data: { reportsToId: managerId } });
  for (const p of changed) {
    await audit(tx, { tenantId, actorId: a?.userId ?? null, action: 'user.manager', entity: 'User', entityId: p.id, before: { reportsToId: p.reportsToId }, after: { reportsToId: managerId } });
  }
  return { changed: changed.length };
}

/** People whose manager is set to this person (the ones to reassign when they leave). */
export async function setReportsOf(tx: Tx, managerId: string) {
  return tx.user.findMany({ where: { reportsToId: managerId, anonymizedAt: null, status: { not: 'TERMINATED' } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
}

// ------------------------------------------------------------------ Routing

/**
 * Who hears about a request needing approval: the person's manager first, then their department's
 * managers, then (as before reporting lines existed) everyone who holds the permission. A manager
 * counts only if they hold the permission and the person is in their scope, so the request they're
 * told about is one they can open.
 */
export async function approversFor(tx: Tx, tenantId: string, subjectIds: string[], permission: Permission, exclude: string[] = []): Promise<{ to: string[]; via: 'manager' | 'department' | 'everyone' }> {
  const skip = new Set([...subjectIds, ...exclude]);
  const g = await loadGraph(tx);
  const able = new Map<string, boolean>();
  const can = async (managerId: string, subjectId: string) => {
    if (skip.has(managerId)) return false;
    const key = `${managerId}:${subjectId}`;
    if (!able.has(key)) {
      const u = await tx.user.findUnique({ where: { id: managerId }, select: { roles: true } });
      const access = u ? await accessOf(tenantId, managerId, u.roles) : null;
      able.set(key, !!access && access.permissions.has(permission) && (await userInScope(tx, access.scope, subjectId)));
    }
    return able.get(key)!;
  };
  const to = new Set<string>();
  let via: 'manager' | 'department' | 'everyone' = 'manager';
  for (const s of subjectIds) {
    const set = g.source(s) === 'set' ? g.managers(s) : [];
    const first = [];
    for (const m of set) if (await can(m, s)) first.push(m);
    if (first.length) {
      first.forEach((m) => to.add(m));
      continue;
    }
    // Their own manager can't approve this: their department's managers.
    const dept = await tx.user.findUnique({ where: { id: s }, select: { positions: { select: { position: { select: { departmentId: true } } } } } });
    const departments = [...new Set((dept?.positions ?? []).map((p) => p.position.departmentId).filter((d): d is string => !!d))];
    const dm = departments.length ? await tx.departmentManager.findMany({ where: { departmentId: { in: departments }, user: { status: 'ACTIVE', anonymizedAt: null } }, select: { userId: true }, orderBy: { createdAt: 'asc' } }) : [];
    const second = [];
    for (const m of [...new Set(dm.map((x) => x.userId))]) if (await can(m, s)) second.push(m);
    if (second.length) {
      second.forEach((m) => to.add(m));
      if (via === 'manager') via = 'department';
      continue;
    }
    (await usersWithPermission(tx, tenantId, permission, [...skip])).forEach((m) => to.add(m));
    via = 'everyone';
  }
  return { to: [...to], via };
}

/** The people who report to this person (their team), for the approvals "My team" filter. */
export async function teamOf(tx: Tx, managerId: string): Promise<string[]> {
  return (await loadGraph(tx)).reports(managerId);
}

/** `?team=mine` on an approval queue: only the people who report to me (it only ever narrows the list). */
export const teamQuery = z.literal('mine').optional();
