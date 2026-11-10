/**
 * Payroll accounting for finance: GL journal entries for each pay run, the
 * chart-of-accounts mapping, department GL codes and labour budgets, and
 * labour cost against budget. HR and finance (accounting.manage); a department
 * manager given the permission sees only their departments' labour cost.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ACCOUNT_KEYS, journalCsv, labourCost, payrollJournal, readAccounts } from '../services/payroll/journal.js';
import { h } from './context.js';

export const accountingRouter = Router();
accountingRouter.use('/accounting', requireFeature('payroll'));
const uuid = z.string().uuid();

accountingRouter.get(
  '/accounting/accounts',
  requirePermission('accounting.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findFirstOrThrow({ select: { accountingSettings: true } }));
    res.json({ accounts: readAccounts(t.accountingSettings), keys: ACCOUNT_KEYS });
  }),
);

accountingRouter.put(
  '/accounting/accounts',
  requirePermission('accounting.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('The chart of accounts is set by HR and finance.');
    const accounts = z.object(Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, z.string().trim().min(1).max(40)])) as Record<(typeof ACCOUNT_KEYS)[number], z.ZodString>).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findFirstOrThrow({ select: { accountingSettings: true } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: { accountingSettings: { ...((t.accountingSettings as object) ?? {}), accounts } } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'accounting.accounts', entity: 'Tenant', entityId: a.tenantId, after: accounts });
    });
    res.json({ ok: true });
  }),
);

accountingRouter.put(
  '/accounting/departments/:id',
  requirePermission('accounting.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('GL codes and budgets are set by HR and finance.');
    const id = uuid.parse(req.params.id);
    const b = z.object({ glCode: z.string().trim().max(40).nullable(), labourBudget: z.number().min(0).max(1_000_000_000).nullable() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.department.findUnique({ where: { id } }))) throw notFound('Department');
      await tx.department.update({ where: { id }, data: b });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'accounting.department', entity: 'Department', entityId: id, after: b });
    });
    res.json({ ok: true });
  }),
);

/** The GL entry for one approved or paid pay run, as JSON or CSV. */
accountingRouter.get(
  ['/accounting/journal/:runId', '/accounting/journal/:runId.csv'],
  requirePermission('accounting.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Journal entries are for HR and finance.');
    const runId = uuid.parse(String(req.params.runId).replace(/\.csv$/, ''));
    const j = await withTenant(a.tenantId, async (tx) => {
      const run = await tx.payRun.findUnique({ where: { id: runId } });
      if (!run) throw notFound('Pay run');
      if (run.status !== 'APPROVED' && run.status !== 'PAID') throw conflict('NOT_APPROVED', 'Only approved pay runs are posted to the ledger.');
      const out = await payrollJournal(tx, runId);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'accounting.journal', entity: 'PayRun', entityId: runId });
      return out;
    });
    if (req.path.endsWith('.csv')) res.type('text/csv').attachment(`journal-${j.date}-${runId.slice(0, 8)}.csv`).send(journalCsv(j));
    else res.json(j);
  }),
);

/** Labour cost by department and month against budget. A department manager sees only their departments. */
accountingRouter.get(
  '/accounting/labour-cost',
  requirePermission('accounting.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year ?? new Date().getFullYear());
    const out = await withTenant(a.tenantId, async (tx) => {
      let only: string[] | null = null;
      if (a.scope) {
        const positions = await tx.position.findMany({ where: { id: { in: a.scope.positionIds } }, select: { departmentId: true } });
        only = [...new Set(positions.map((p) => p.departmentId).filter((x): x is string => !!x))];
      }
      const r = await labourCost(tx, year, only);
      return only ? { ...r, budgets: r.budgets.filter((b) => only!.includes(b.id)) } : r;
    });
    res.json(out);
  }),
);
