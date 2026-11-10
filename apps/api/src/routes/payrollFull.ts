/** Full payroll in the app: salaries, one-time payments and deductions on a run, and court or CRA orders. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ADJUSTMENT_KINDS, buildRun, runInput } from '../services/payroll/payRuns.js';
import { h } from './context.js';

export const payrollFullRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = (max: number) => z.number().positive().max(max).multipleOf(0.01);
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
const wholeCity = (scope: unknown) => {
  if (scope) throw forbidden('Salaries and payroll orders are set by HR for the whole organization.');
};
const person = async (tx: Tx, userId: string) => {
  if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Person');
};

/* ---------- Salaries ---------- */
const salaryView = (x: { id: string; userId: string; positionId: string; annualAmount: unknown; weeklyHours: unknown; overtimeEligible: boolean; effectiveFrom: Date; effectiveTo: Date | null }) => ({
  id: x.id, userId: x.userId, positionId: x.positionId, annualAmount: Number(x.annualAmount), weeklyHours: Number(x.weeklyHours), overtimeEligible: x.overtimeEligible,
  effectiveFrom: x.effectiveFrom.toISOString().slice(0, 10), effectiveTo: x.effectiveTo?.toISOString().slice(0, 10) ?? null,
});

payrollFullRouter.get(
  '/users/:id/salary',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const userId = uuid.parse(req.params.id);
    res.json((await withTenant(a.tenantId, (tx) => tx.salary.findMany({ where: { userId }, orderBy: { effectiveFrom: 'desc' } }))).map(salaryView));
  }),
);

/** A new salary from a date; the previous one ends the day before. */
payrollFullRouter.post(
  '/users/:id/salary',
  requirePermission('payroll.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const userId = uuid.parse(req.params.id);
    const b = z.object({ positionId: uuid, annualAmount: money(10_000_000), weeklyHours: z.number().min(1).max(80).default(37.5), overtimeEligible: z.boolean().default(false), effectiveFrom: isoDate }).parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      await person(tx, userId);
      if (!(await tx.position.findUnique({ where: { id: b.positionId } }))) throw notFound('Position');
      const dayBefore = new Date(Date.parse(b.effectiveFrom) - 86_400_000);
      // Whatever salary is still running on the new start date (open-ended or ending later) ends the day before.
      await tx.salary.updateMany({ where: { userId, effectiveFrom: { lt: new Date(b.effectiveFrom) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(b.effectiveFrom) } }] }, data: { effectiveTo: dayBefore } });
      if (await tx.salary.findFirst({ where: { userId, effectiveFrom: { gte: new Date(b.effectiveFrom) } } })) throw conflict('SALARY_LATER', 'There is already a salary starting on or after that date. End or change that one.');
      const created = await tx.salary.create({ data: { tenantId: a.tenantId, userId, ...b, effectiveFrom: new Date(b.effectiveFrom), createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.salary.set', entity: 'User', entityId: userId, after: b });
      return created;
    });
    res.status(201).json(salaryView(row));
  }),
);

/** Back to hourly pay from a date (or end a salary on leaving). */
payrollFullRouter.post(
  '/users/:id/salary/end',
  requirePermission('payroll.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const userId = uuid.parse(req.params.id);
    const { lastDay } = z.object({ lastDay: isoDate }).parse(req.body);
    const n = await withTenant(a.tenantId, async (tx) => {
      const r = await tx.salary.updateMany({ where: { userId, effectiveTo: null }, data: { effectiveTo: new Date(lastDay) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.salary.end', entity: 'User', entityId: userId, after: { lastDay } });
      return r.count;
    });
    res.json({ ended: n });
  }),
);

/* ---------- One-time payments and deductions on a draft run ---------- */
const draftRun = async (tx: Tx, runId: string) => {
  const r = await tx.payRun.findUnique({ where: { id: runId } });
  if (!r) throw notFound('Pay run');
  if (r.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'One-time items can only change on a draft pay run.');
  return r;
};

payrollFullRouter.get(
  '/payroll/runs/:id/adjustments',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const payRunId = uuid.parse(req.params.id);
    const rows = await withTenant(a.tenantId, (tx) => tx.payAdjustment.findMany({ where: { payRunId }, orderBy: { createdAt: 'asc' } }));
    res.json(rows.map((x) => ({ id: x.id, userId: x.userId, kind: x.kind, description: x.description, amount: Number(x.amount), positionId: x.positionId })));
  }),
);

payrollFullRouter.post(
  '/payroll/runs/:id/adjustments',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const payRunId = uuid.parse(req.params.id);
    const b = z.object({ userId: uuid, kind: z.enum(ADJUSTMENT_KINDS), description: z.string().trim().min(2).max(120), amount: money(1_000_000), positionId: uuid.nullable().optional() }).parse(req.body);
    const run = await withTenant(a.tenantId, async (tx) => {
      const r = await draftRun(tx, payRunId);
      await person(tx, b.userId);
      const x = await tx.payAdjustment.create({ data: { tenantId: a.tenantId, payRunId, ...b, positionId: b.positionId ?? null, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.adjustment.add', entity: 'PayAdjustment', entityId: x.id, after: b });
      return buildRun(tx, a.tenantId, r.preparedById, runInput(r), r.id);
    });
    res.status(201).json({ totals: run.totals, blockers: run.blockers });
  }),
);

payrollFullRouter.delete(
  '/payroll/runs/:id/adjustments/:adjustmentId',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const payRunId = uuid.parse(req.params.id);
    const id = uuid.parse(req.params.adjustmentId);
    await withTenant(a.tenantId, async (tx) => {
      const r = await draftRun(tx, payRunId);
      const x = await tx.payAdjustment.findFirst({ where: { id, payRunId } });
      if (!x) throw notFound('One-time item');
      await tx.payAdjustment.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.adjustment.remove', entity: 'PayAdjustment', entityId: id, before: { kind: x.kind, amount: Number(x.amount), userId: x.userId } });
      await buildRun(tx, a.tenantId, r.preparedById, runInput(r), r.id);
    });
    res.status(204).end();
  }),
);

/* ---------- Court and CRA orders ---------- */
const orderView = (o: { id: string; userId: string; kind: string; payee: string; reference: string | null; amountPerPay: unknown; percentOfNet: unknown; maxPercentOfNet: unknown; totalOwed: unknown; startsOn: Date; endsOn: Date | null }) => ({
  id: o.id, userId: o.userId, kind: o.kind, payee: o.payee, reference: o.reference,
  amountPerPay: o.amountPerPay == null ? null : Number(o.amountPerPay), percentOfNet: o.percentOfNet == null ? null : Number(o.percentOfNet),
  maxPercentOfNet: Number(o.maxPercentOfNet), totalOwed: o.totalOwed == null ? null : Number(o.totalOwed),
  startsOn: o.startsOn.toISOString().slice(0, 10), endsOn: o.endsOn?.toISOString().slice(0, 10) ?? null,
});

payrollFullRouter.get(
  '/users/:id/payroll-orders',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const userId = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const orders = await tx.payDeductionOrder.findMany({ where: { userId }, orderBy: { startsOn: 'desc' } });
      const statements = await tx.payStatement.findMany({ where: { userId, payRun: { status: { in: ['APPROVED', 'PAID'] } } }, select: { deductions: true } });
      const collected = new Map<string, number>();
      for (const st of statements) for (const o of ((st.deductions as { orders?: Array<{ id: string; amount: number }> }).orders ?? [])) collected.set(o.id, (collected.get(o.id) ?? 0) + o.amount);
      return orders.map((o) => ({ ...orderView(o), collected: Math.round((collected.get(o.id) ?? 0) * 100) / 100 }));
    });
    res.json(out);
  }),
);

payrollFullRouter.post(
  '/users/:id/payroll-orders',
  requirePermission('payroll.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const userId = uuid.parse(req.params.id);
    const b = z
      .object({
        kind: z.enum(['GARNISHMENT', 'SUPPORT_ORDER', 'CRA_REQUIREMENT', 'OTHER']),
        payee: z.string().trim().min(2).max(120),
        reference: z.string().trim().max(60).nullable().optional(),
        amountPerPay: money(100_000).nullable().optional(),
        percentOfNet: z.number().positive().max(100).nullable().optional(),
        maxPercentOfNet: z.number().positive().max(100).default(50),
        totalOwed: money(10_000_000).nullable().optional(),
        startsOn: isoDate,
        endsOn: isoDate.nullable().optional(),
      })
      .refine((x) => (x.amountPerPay == null) !== (x.percentOfNet == null), { message: 'Give either an amount each pay or a percent of net pay.' })
      .parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      await person(tx, userId);
      const o = await tx.payDeductionOrder.create({ data: { tenantId: a.tenantId, userId, ...b, reference: b.reference ?? null, amountPerPay: b.amountPerPay ?? null, percentOfNet: b.percentOfNet ?? null, totalOwed: b.totalOwed ?? null, startsOn: new Date(b.startsOn), endsOn: b.endsOn ? new Date(b.endsOn) : null, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.order.add', entity: 'PayDeductionOrder', entityId: o.id, after: b });
      return o;
    });
    res.status(201).json(orderView(row));
  }),
);

/** Orders are kept as records: ending one sets its last day. */
payrollFullRouter.post(
  '/users/:id/payroll-orders/:orderId/end',
  requirePermission('payroll.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a.scope);
    const userId = uuid.parse(req.params.id);
    const id = uuid.parse(req.params.orderId);
    const { endsOn } = z.object({ endsOn: isoDate }).parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      const o = await tx.payDeductionOrder.findFirst({ where: { id, userId } });
      if (!o) throw notFound('Order');
      const u = await tx.payDeductionOrder.update({ where: { id }, data: { endsOn: new Date(endsOn) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.order.end', entity: 'PayDeductionOrder', entityId: id, after: { endsOn } });
      return u;
    });
    res.json(orderView(row));
  }),
);
