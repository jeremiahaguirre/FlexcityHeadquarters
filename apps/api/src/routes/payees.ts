/** Payees who aren't employees and what they were paid, for T4A slips (services/payroll/t4a.ts). */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import type { AuthContext } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { seal } from '../services/crypto/envelope.js';
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;
import { validSin } from '../services/payroll/bank.js';
import { T4A_BOXES, payeeName, sinAad, t4aSlips } from '../services/payroll/t4a.js';
import { h, keys, tenantKekId } from './context.js';

export const payeesRouter = Router();
payeesRouter.use(['/payees', '/payroll/t4a'], requireFeature('payroll'), requirePermission('payroll.export'));
const uuid = z.string().uuid();
const wholeCity = (a: AuthContext) => {
  if (a.scope) throw forbidden('Payees are for the whole organization, kept by HR.');
};
const address = z.object({ line1: z.string().trim().min(3).max(60), line2: z.string().trim().max(60).nullable().optional(), city: z.string().trim().min(2).max(40), province: z.enum(PROVINCES), postalCode: z.string().trim().regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, 'A postal code looks like A1A 1A1.') });
const payeeBody = z
  .object({
    kind: z.enum(['PERSON', 'BUSINESS']),
    firstName: z.string().trim().max(60).nullable().optional(),
    lastName: z.string().trim().max(60).nullable().optional(),
    businessName: z.string().trim().max(120).nullable().optional(),
    businessNumber: z.string().trim().regex(/^\d{9}([A-Z]{2}\d{4})?$/, 'A business number is 9 digits (optionally with RT0001).').nullable().optional(),
    sin: z.string().trim().optional(),
    address: address.nullable().optional(),
    email: z.string().trim().email().max(160).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => (b.kind === 'PERSON' ? !!b.firstName && !!b.lastName : !!b.businessName), { message: 'Give the person’s name, or the business’s.', path: ['firstName'] });

const view = (p: { id: string; kind: string; firstName: string | null; lastName: string | null; businessName: string | null; businessNumber: string | null; sinLast3: string | null; address: unknown; email: string | null; notes: string | null; archivedAt: Date | null }) => ({
  id: p.id, kind: p.kind, name: payeeName(p), firstName: p.firstName, lastName: p.lastName, businessName: p.businessName, businessNumber: p.businessNumber, sin: p.sinLast3 ? `•••-•••-${p.sinLast3}` : null, address: p.address, email: p.email, notes: p.notes, archived: !!p.archivedAt,
});

async function sealed(tenantId: string, id: string, sin: string | undefined) {
  if (!sin) return {};
  const d = sin.replace(/\D/g, '');
  if (!validSin(d)) throw new HttpError(400, 'INVALID_SIN', 'That isn’t a valid Social Insurance Number.');
  const s = await seal(keys(), tenantKekId(tenantId), d, sinAad(tenantId, id));
  return { sinCiphertext: s.ciphertext, sinIv: s.iv, sinAuthTag: s.authTag, sinWrappedKey: s.wrappedDataKey, sinKekId: s.kekId, sinLast3: d.slice(-3) };
}

payeesRouter.get(
  '/payees',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year ?? new Date().getUTCFullYear());
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const payees = await tx.payee.findMany({ where: { archivedAt: null }, orderBy: [{ lastName: 'asc' }, { businessName: 'asc' }] });
        const pays = await tx.payeePayment.findMany({ where: { paidOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { paidOn: 'desc' } });
        return payees.map((p) => {
          const mine = pays.filter((x) => x.payeeId === p.id);
          return { ...view(p), paid: Math.round(mine.reduce((s, x) => s + Number(x.amount), 0) * 100) / 100, payments: mine.map((x) => ({ id: x.id, paidOn: x.paidOn.toISOString().slice(0, 10), box: x.box, amount: Number(x.amount), taxWithheld: Number(x.taxWithheld), description: x.description })) };
        });
      }),
    );
  }),
);

payeesRouter.post(
  '/payees',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const { sin, ...b } = payeeBody.parse(req.body);
    const p = await withTenant(a.tenantId, async (tx) => {
      const id = crypto.randomUUID();
      const p = await tx.payee.create({ data: { id, tenantId: a.tenantId, kind: b.kind, firstName: b.firstName ?? null, lastName: b.lastName ?? null, businessName: b.businessName ?? null, businessNumber: b.businessNumber ?? null, address: b.address ?? undefined, email: b.email ?? null, notes: b.notes ?? null, ...(b.kind === 'PERSON' ? await sealed(a.tenantId, id, sin) : {}) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payee.create', entity: 'Payee', entityId: id, after: { kind: b.kind, name: payeeName(p), sin: sin ? 'set' : undefined } });
      return p;
    });
    res.status(201).json(view(p));
  }),
);

payeesRouter.patch(
  '/payees/:id',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const id = uuid.parse(req.params.id);
    const { sin, ...b } = payeeBody.parse(req.body);
    const p = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.payee.findUnique({ where: { id } }))) throw notFound('Payee');
      const p = await tx.payee.update({ where: { id }, data: { kind: b.kind, firstName: b.firstName ?? null, lastName: b.lastName ?? null, businessName: b.businessName ?? null, businessNumber: b.businessNumber ?? null, address: b.address ?? undefined, email: b.email ?? null, notes: b.notes ?? null, ...(b.kind === 'PERSON' ? await sealed(a.tenantId, id, sin) : {}) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payee.update', entity: 'Payee', entityId: id, after: { sin: sin ? 'changed' : undefined } });
      return p;
    });
    res.json(view(p));
  }),
);

payeesRouter.post(
  '/payees/:id/archive',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.payee.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } });
      if (!done.count) throw notFound('Payee');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payee.archive', entity: 'Payee', entityId: id });
    });
    res.json({ ok: true });
  }),
);

payeesRouter.post(
  '/payees/:id/payments',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const payeeId = uuid.parse(req.params.id);
    const b = z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), box: z.enum(Object.keys(T4A_BOXES) as ['048', '028', '020']), amount: z.number().positive().max(10_000_000), taxWithheld: z.number().min(0).max(10_000_000).default(0), description: z.string().trim().min(2).max(160) }).parse(req.body);
    const x = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.payee.findUnique({ where: { id: payeeId } }))) throw notFound('Payee');
      const x = await tx.payeePayment.create({ data: { tenantId: a.tenantId, payeeId, paidOn: new Date(b.paidOn), box: b.box, amount: b.amount, taxWithheld: b.taxWithheld, description: b.description, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payee.payment', entity: 'Payee', entityId: payeeId, after: b });
      return x;
    });
    res.status(201).json({ id: x.id });
  }),
);

payeesRouter.delete(
  '/payees/:id/payments/:paymentId',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const id = uuid.parse(req.params.paymentId);
    await withTenant(a.tenantId, async (tx) => {
      const x = await tx.payeePayment.findUnique({ where: { id } });
      if (!x) throw notFound('Payment');
      await tx.payeePayment.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payee.payment_remove', entity: 'Payee', entityId: x.payeeId, before: { amount: Number(x.amount), box: x.box, paidOn: x.paidOn } });
    });
    res.status(204).end();
  }),
);

/** The year's T4A slips (no SINs): who gets one, by box. */
payeesRouter.get(
  '/payroll/t4a',
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    res.json(await withTenant(a.tenantId, (tx) => t4aSlips(tx, year)));
  }),
);
