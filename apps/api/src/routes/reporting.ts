/**
 * Reporting lines and the org chart (services/people/reporting.ts).
 * Everything here stays inside what the viewer may already see: their permission and department scope.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { allOf, departmentFilter, departmentQuery } from '../services/people/departmentAdmin.js';
import { type ReportingGraph, canSetManager, loadGraph, setManagers, treeParents } from '../services/people/reporting.js';
import { peopleWhere } from '../services/people/scope.js';
import type { Tx } from '../lib/db.js';
import { h } from './context.js';

export const reportingRouter = Router();
const uuid = z.string().uuid();

type Pos = { id: string; name: string; nameFr: string | null };
const personSelect = { id: true, firstName: true, lastName: true, status: true, positions: { select: { position: { select: { id: true, name: true, nameFr: true } } } } } as const;
const card = (u: { id: string; firstName: string; lastName: string; positions: Array<{ position: Pos }> }) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, positions: u.positions.map((p) => p.position) });

/** Reports to, and direct reports, as `viewer` may see them (people outside their scope are left out). */
async function reportingView(tx: Tx, g: ReportingGraph, id: string, visible: (ids: string[]) => Promise<Set<string>>) {
  const managerIds = g.managers(id);
  const reportIds = g.reports(id);
  const seen = await visible([...managerIds, ...reportIds]);
  const people = await tx.user.findMany({ where: { id: { in: [...seen] } }, select: personSelect, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  const byId = new Map(people.map((p) => [p.id, card(p)]));
  return {
    source: g.source(id),
    managers: managerIds.filter((m) => byId.has(m)).map((m) => byId.get(m)!),
    directReports: people.filter((p) => reportIds.includes(p.id)).map(card),
  };
}

const inScope = (tx: Tx, a: ReturnType<typeof authOf>) => async (ids: string[]) =>
  new Set((await tx.user.findMany({ where: { id: { in: ids }, anonymizedAt: null, ...peopleWhere(a.scope) }, select: { id: true } })).map((u) => u.id));

/** A person's manager and direct reports (person page). */
reportingRouter.get(
  '/users/:id/reporting',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { id, anonymizedAt: null, ...peopleWhere(a.scope) }, select: { reportsToId: true } });
      if (!u) throw notFound('Person');
      const g = await loadGraph(tx);
      return { ...(await reportingView(tx, g, id, inScope(tx, a))), reportsToId: u.reportsToId, canEdit: await canSetManager(tx, a, id) };
    });
    res.json(out);
  }),
);

/** Set or clear (null: back to the department's manager) one person's manager. */
reportingRouter.put(
  '/users/:id/manager',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { managerId } = z.object({ managerId: uuid.nullable() }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => setManagers(tx, a, a.tenantId, [id], managerId)));
  }),
);

/** The same for several people at once (from the staff list), all or nothing. */
reportingRouter.post(
  '/reporting/managers',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ userIds: z.array(uuid).min(1).max(500), managerId: uuid.nullable() }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => setManagers(tx, a, a.tenantId, b.userIds, b.managerId)));
  }),
);

/** My manager and the people who report to me (profile, approvals). Names only: no access comes with it. */
reportingRouter.get(
  '/me/reporting',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const g = await loadGraph(tx);
      return reportingView(tx, g, a.userId, async (ids) => new Set(ids));
    });
    res.json(out);
  }),
);

/**
 * The org chart: everyone the viewer may see (their scope, optionally one department), each
 * under their manager. Someone whose manager is outside the view starts a branch of their own.
 */
reportingRouter.get(
  '/org-chart',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ department: departmentQuery }).parse(req.query);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [people, departments, g] = await Promise.all([
        tx.user.findMany({
          where: { status: 'ACTIVE', anonymizedAt: null, ...allOf(peopleWhere(a.scope), departmentFilter(q.department)) },
          select: { ...personSelect, positions: { select: { position: { select: { id: true, name: true, nameFr: true, departmentId: true } } } } },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
        tx.department.findMany({ select: { id: true, name: true, nameFr: true } }),
        loadGraph(tx),
      ]);
      const ids = people.map((p) => p.id);
      const parents = treeParents(ids, g.parent);
      const count = new Map<string, number>();
      for (const p of parents.values()) if (p) count.set(p, (count.get(p) ?? 0) + 1);
      const deptName = new Map(departments.map((d) => [d.id, d]));
      return {
        people: people.map((p) => ({
          ...card(p),
          departments: [...new Set(p.positions.map((x) => x.position.departmentId).filter((d): d is string => !!d))].map((d) => deptName.get(d)!).filter(Boolean),
          managerId: parents.get(p.id) ?? null,
          source: parents.get(p.id) ? g.source(p.id) : null,
          directReports: count.get(p.id) ?? 0,
        })),
      };
    });
    res.json(out);
  }),
);
