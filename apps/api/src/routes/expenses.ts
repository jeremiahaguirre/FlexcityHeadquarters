/** Expense and mileage claims (services/payroll/expenses.ts). Paid on the next pay run once approved. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import type { Tx } from '../lib/db.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { kmThisYear, mileageAmount, mileagePolicy } from '../services/payroll/expenses.js';
import { readSettings } from '../services/payroll/payRuns.js';
import { peopleInScope, userInScope } from '../services/people/scope.js';
import { store } from './documents.js';
import { h } from './context.js';

export const expensesRouter = Router();
expensesRouter.use(['/expenses', '/me/expenses'], requireFeature('expenses'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CATEGORIES = ['MILEAGE', 'MEALS', 'TRAVEL', 'PARKING', 'SUPPLIES', 'TRAINING', 'OTHER'] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;
const policyOf = async (tx: Tx) => mileagePolicy(readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings));

const item = z.object({
  date: isoDate,
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(2).max(160),
  amount: z.number().positive().max(10_000).optional(),
  km: z.number().positive().max(5_000).optional(),
  salesTax: z.number().min(0).max(5_000).nullable().optional(),
  receipt: z.object({ fileName: z.string().trim().min(1).max(160), data: z.string().regex(/^data:[\w.+/-]+;base64,/).max(14_000_000) }).nullable().optional(),
});

type ClaimRow = { id: string; userId: string; title: string; status: string; total: unknown; submittedAt: Date; decidedAt: Date | null; decisionNote: string | null; payRunId: string | null; items: Array<{ id: string; date: Date; category: string; description: string; amount: unknown; km: unknown; centsPerKm: unknown; salesTax: unknown; receiptDocumentId: string | null }> };
const view = (c: ClaimRow, name?: string) => ({
  id: c.id,
  userId: c.userId,
  ...(name !== undefined ? { name } : {}),
  title: c.title,
  status: c.status,
  total: Number(c.total),
  submittedAt: c.submittedAt,
  decidedAt: c.decidedAt,
  decisionNote: c.decisionNote,
  paid: !!c.payRunId,
  items: c.items.map((i) => ({ id: i.id, date: i.date.toISOString().slice(0, 10), category: i.category, description: i.description, amount: Number(i.amount), km: i.km == null ? null : Number(i.km), centsPerKm: i.centsPerKm == null ? null : Number(i.centsPerKm), salesTax: i.salesTax == null ? null : Number(i.salesTax), receiptId: i.receiptDocumentId })),
});

expensesRouter.get(
  '/me/expenses',
  requirePermission('expenses.self'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const policy = await policyOf(tx);
        const claims = await tx.expenseClaim.findMany({ where: { userId: a.userId }, orderBy: { submittedAt: 'desc' }, take: 50, include: { items: { orderBy: { date: 'asc' } } } });
        return { policy, kmThisYear: await kmThisYear(tx, a.userId, new Date().getUTCFullYear()), claims: claims.map((c) => view(c)) };
      }),
    );
  }),
);

expensesRouter.post(
  '/me/expenses',
  requirePermission('expenses.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ title: z.string().trim().min(2).max(120), items: z.array(item).min(1).max(30) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const policy = await policyOf(tx);
      const kmBefore = new Map<number, number>();
      const rows = [];
      for (const [n, i] of b.items.entries()) {
        const at = `Line ${n + 1}`;
        if (i.date > new Date().toISOString().slice(0, 10)) throw badRequest(`${at}: the date is in the future.`);
        if (i.category === 'MILEAGE') {
          if (!i.km) throw badRequest(`${at}: enter the kilometres driven.`);
          const year = Number(i.date.slice(0, 4));
          const before = kmBefore.get(year) ?? (await kmThisYear(tx, a.userId, year));
          const m = mileageAmount(before, i.km, policy);
          kmBefore.set(year, before + i.km);
          rows.push({ ...i, amount: m.amount, centsPerKm: m.centsPerKm, receipt: null });
        } else {
          if (!i.amount) throw badRequest(`${at}: enter the amount.`);
          if (i.amount > policy.receiptOver && !i.receipt) throw new HttpError(400, 'RECEIPT_NEEDED', `${at}: attach the receipt (needed above $${policy.receiptOver}).`, { line: n + 1 });
          rows.push({ ...i, amount: r2(i.amount), centsPerKm: null });
        }
      }
      const total = r2(rows.reduce((s, r) => s + r.amount, 0));
      const claim = await tx.expenseClaim.create({ data: { tenantId: a.tenantId, userId: a.userId, title: b.title, total } });
      for (const r of rows) {
        const doc = r.receipt ? await store(tx, a, a.userId, { kind: 'RECEIPT', title: `Receipt: ${r.description}`.slice(0, 120), fileName: r.receipt.fileName, data: r.receipt.data, shareWithDepartment: true }) : null;
        await tx.expenseItem.create({ data: { tenantId: a.tenantId, claimId: claim.id, date: new Date(r.date), category: r.category, description: r.description, amount: r.amount, km: r.km ?? null, centsPerKm: r.centsPerKm, salesTax: r.salesTax ?? null, receiptDocumentId: doc?.id ?? null } });
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'expense.submit', entity: 'ExpenseClaim', entityId: claim.id, after: { total, items: rows.length } });
      const approvers = (await usersWithPermission(tx, a.tenantId, 'expenses.approve', [a.userId])).slice(0, 50);
      const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
      await notify(tx, a.tenantId, approvers.map((userId) => ({ userId, type: 'expense_submitted', params: { name: `${me.firstName} ${me.lastName}`, total }, link: '/manage/expenses' })));
      return view(await tx.expenseClaim.findUniqueOrThrow({ where: { id: claim.id }, include: { items: { orderBy: { date: 'asc' } } } }));
    });
    res.status(201).json(out);
  }),
);

expensesRouter.post(
  '/me/expenses/:id/withdraw',
  requirePermission('expenses.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.expenseClaim.updateMany({ where: { id, userId: a.userId, status: 'SUBMITTED' }, data: { status: 'WITHDRAWN' } });
      if (!done.count) throw conflict('NOT_SUBMITTED', 'Only a claim waiting for approval can be withdrawn.');
    });
    res.json({ ok: true });
  }),
);

/** Approvers: claims from people in their department. */
expensesRouter.get(
  '/expenses',
  requirePermission('expenses.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const status = z.enum(['SUBMITTED', 'APPROVED', 'PAID', 'REJECTED']).default('SUBMITTED').parse(req.query.status);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const scope = await peopleInScope(tx, a.scope);
        const claims = await tx.expenseClaim.findMany({ where: { status, ...(scope ? { userId: { in: [...scope] } } : {}) }, orderBy: { submittedAt: 'asc' }, take: 200, include: { items: { orderBy: { date: 'asc' } } } });
        const people = await tx.user.findMany({ where: { id: { in: claims.map((c) => c.userId) } }, select: { id: true, firstName: true, lastName: true } });
        return claims.map((c) => {
          const p = people.find((x) => x.id === c.userId);
          return view(c, p ? `${p.firstName} ${p.lastName}` : '');
        });
      }),
    );
  }),
);

expensesRouter.post(
  '/expenses/:id/decision',
  requirePermission('expenses.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(300).nullable().optional() }).refine((x) => x.decision === 'APPROVE' || !!x.note, { message: 'Say why the claim isn’t approved.', path: ['note'] }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.expenseClaim.findUnique({ where: { id } });
      if (!c) throw notFound('Claim');
      if (c.userId === a.userId) throw forbidden('Someone else has to approve your own claim.');
      if (!(await userInScope(tx, a.scope, c.userId))) throw notFound('Claim');
      if (c.status !== 'SUBMITTED') throw conflict('NOT_SUBMITTED', 'This claim was already decided.');
      const status = b.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.expenseClaim.update({ where: { id }, data: { status, decidedById: a.userId, decidedAt: new Date(), decisionNote: b.note ?? null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: `expense.${status.toLowerCase()}`, entity: 'ExpenseClaim', entityId: id, after: { total: Number(c.total), note: b.note ?? null } });
      await notify(tx, a.tenantId, [{ userId: c.userId, type: status === 'APPROVED' ? 'expense_approved' : 'expense_rejected', params: { title: c.title, total: Number(c.total), note: b.note ?? '' }, link: '/expenses' }]);
    });
    res.json({ ok: true });
  }),
);
