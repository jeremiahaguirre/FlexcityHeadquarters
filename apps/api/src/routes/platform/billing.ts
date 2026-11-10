/** FH Dev console: billing accounts, invoices and payments for every organization. */
import { Router } from 'express';
import { z } from 'zod';
import { platformOf } from '../../auth/platform.js';
import { config } from '../../config.js';
import { db, tenantIds, withTenant } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import {
  accountBody,
  displayStatus,
  draftPatch,
  estimate,
  generateDraft,
  getAccount,
  monthBounds,
  paymentBody,
  recordPayment,
  saveAccount,
  sendInvoice,
  updateDraft,
  voidInvoice,
} from '../../services/billing/invoices.js';
import { TAX_RATES_AS_OF, TAX_RATES_VERIFIED } from '../../services/billing/tax.js';
import { billingState } from '../../services/billing/entitlements.js';
import { catalog, itemStates } from '../../services/billing/catalog.js';
import { assertOpenPeriod } from '../../services/billing/books.js';
import { h } from '../context.js';

export const billingRouter = Router();
const uuid = z.string().uuid();
const thisMonth = () => new Date().toISOString().slice(0, 7);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function names() {
  const ids = await tenantIds();
  const rows = await Promise.all(ids.map((id) => withTenant(id, (tx) => tx.tenant.findUnique({ where: { id }, select: { id: true, name: true, subdomain: true } }))));
  return new Map(rows.filter(Boolean).map((r) => [r!.id, r!]));
}

async function audit(adminId: string, tenantId: string | null, action: string, detail?: object) {
  await db().platformAudit.create({ data: { adminId, tenantId, action, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });
}

const invoiceView = (inv: Awaited<ReturnType<typeof loadInvoice>>, org?: { name: string; subdomain: string }) => ({
  id: inv.id,
  tenantId: inv.tenantId,
  organization: org ?? null,
  number: inv.number,
  status: displayStatus(inv),
  periodStart: iso(inv.periodStart),
  periodEnd: iso(inv.periodEnd),
  issueDate: iso(inv.issueDate),
  dueDate: iso(inv.dueDate),
  currency: inv.currency,
  subtotalCents: inv.subtotalCents,
  taxLines: inv.taxLines,
  totalCents: inv.totalCents,
  paidCents: inv.paidCents,
  balanceCents: inv.status === 'VOID' ? 0 : inv.totalCents - inv.paidCents,
  billTo: inv.billTo,
  poNumber: inv.poNumber,
  notes: inv.notes,
  voidReason: inv.voidReason,
  lines: inv.lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), unitCents: l.unitCents, amountCents: l.amountCents })),
  payments: inv.payments.map((p) => ({ id: p.id, amountCents: p.amountCents, receivedOn: iso(p.receivedOn), method: p.method, reference: p.reference })),
});

async function loadInvoice(id: string) {
  const inv = await db().invoice.findUnique({ where: { id }, include: { lines: { orderBy: { position: 'asc' } }, payments: { orderBy: { receivedOn: 'asc' } } } });
  if (!inv) throw notFound('Invoice');
  return inv;
}

/** Revenue at a glance, and every organization with its monthly amount. */
billingRouter.get(
  '/billing/summary',
  h(async (_req, res) => {
    const orgs = await names();
    const month = thisMonth();
    const accounts = await db().billingAccount.findMany();
    const cities = await Promise.all(
      [...orgs.values()].map(async (o) => {
        const est = accounts.some((a) => a.tenantId === o.id) ? await estimate(o.id, month) : null;
        return { tenantId: o.id, name: o.name, subdomain: o.subdomain, hasAccount: !!est, monthlySubtotalCents: est?.subtotalCents ?? 0, monthlyTotalCents: est?.totalCents ?? 0 };
      }),
    );
    const open = await db().invoice.findMany({ where: { status: 'SENT' } });
    const { start, next } = monthBounds(month);
    const paidThisMonth = await db().invoicePayment.aggregate({ _sum: { amountCents: true }, where: { receivedOn: { gte: start, lt: next } } });
    const overdue = open.filter((i) => displayStatus(i) === 'OVERDUE');
    res.json({
      month,
      cities: cities.sort((a, b) => a.name.localeCompare(b.name)),
      totals: {
        mrrCents: cities.reduce((s, c) => s + c.monthlySubtotalCents, 0),
        outstandingCents: open.reduce((s, i) => s + i.totalCents - i.paidCents, 0),
        overdueCents: overdue.reduce((s, i) => s + i.totalCents - i.paidCents, 0),
        overdueCount: overdue.length,
        paidThisMonthCents: paidThisMonth._sum.amountCents ?? 0,
      },
      issuer: { legalName: config().BILLING_LEGAL_NAME, gstNumberSet: !!config().BILLING_GST_NUMBER },
      tax: { verified: TAX_RATES_VERIFIED, asOf: TAX_RATES_AS_OF },
    });
  }),
);

billingRouter.get(
  '/billing/accounts/:tenantId',
  h(async (req, res) => {
    const tenantId = uuid.parse(req.params.tenantId);
    const { tenant, account, facilities } = await getAccount(tenantId);
    res.json({
      organization: tenant,
      account,
      facilities: facilities.map((f) => ({ id: f.id, name: f.name, province: f.province, tier: f.billingTier, customCents: f.billingMonthlyCents })),
      estimate: account ? await estimate(tenantId, thisMonth()) : null,
      // The plans to choose from, with list prices and what each includes.
      catalog: catalog(),
      // Every option for this organization: on or off, standard for the plan or not, and its price.
      items: account ? itemStates(account) : null,
      // Where the organization stands: trial, overdue (warning) or suspended (read-only).
      state: await billingState(tenantId),
    });
  }),
);

billingRouter.put(
  '/billing/accounts/:tenantId',
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.tenantId);
    const body = accountBody.parse(req.body);
    await getAccount(tenantId); // 404 for unknown organizations
    await saveAccount(tenantId, body);
    await audit(p.adminId, tenantId, 'billing.account', body);
    res.json({ estimate: await estimate(tenantId, thisMonth()) });
  }),
);

/** Drafts this month's invoices (one organization or all with a billing account). */
billingRouter.post(
  '/billing/invoices/generate',
  h(async (req, res) => {
    const p = platformOf(req);
    const body = z.object({ month: z.string(), tenantIds: z.array(uuid).max(500).optional() }).parse(req.body);
    monthBounds(body.month);
    const targets = body.tenantIds ?? (await db().billingAccount.findMany({ select: { tenantId: true } })).map((a) => a.tenantId);
    const results: Record<string, number> = { created: 0, exists: 0, 'no-account': 0, 'nothing-to-bill': 0 };
    for (const t of targets) results[await generateDraft(t, body.month, p.adminId)]!++;
    await audit(p.adminId, null, 'billing.generate', { month: body.month, ...results });
    res.json(results);
  }),
);

billingRouter.get(
  '/billing/invoices',
  h(async (req, res) => {
    const q = z.object({ tenantId: uuid.optional(), status: z.enum(['DRAFT', 'SENT', 'PAID', 'VOID', 'OVERDUE', 'OPEN']).optional() }).parse(req.query);
    const where = {
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.status === 'OVERDUE' || q.status === 'OPEN' ? { status: 'SENT' as const } : q.status ? { status: q.status } : {}),
    };
    const [rows, orgs] = await Promise.all([
      db().invoice.findMany({ where, include: { lines: { orderBy: { position: 'asc' } }, payments: true }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }], take: 500 }),
      names(),
    ]);
    const list = rows.map((r) => invoiceView(r, orgs.get(r.tenantId)));
    res.json(q.status === 'OVERDUE' ? list.filter((i) => i.status === 'OVERDUE') : list);
  }),
);

billingRouter.get(
  '/billing/invoices/:id',
  h(async (req, res) => {
    const inv = await loadInvoice(uuid.parse(req.params.id));
    const orgs = await names();
    res.json({
      ...invoiceView(inv, orgs.get(inv.tenantId)),
      issuer: { legalName: config().BILLING_LEGAL_NAME, address: config().BILLING_ADDRESS, email: config().BILLING_EMAIL, gstNumber: config().BILLING_GST_NUMBER, qstNumber: config().BILLING_QST_NUMBER, remittance: config().BILLING_REMITTANCE },
    });
  }),
);

billingRouter.patch(
  '/billing/invoices/:id',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = draftPatch.parse(req.body);
    await updateDraft(id, body);
    const inv = await loadInvoice(id);
    await audit(p.adminId, inv.tenantId, 'invoice.edit', { id, ...body });
    res.json(invoiceView(inv));
  }),
);

billingRouter.post(
  '/billing/invoices/:id/send',
  h(async (req, res) => {
    const p = platformOf(req);
    const sent = await sendInvoice(uuid.parse(req.params.id));
    await audit(p.adminId, sent.tenantId, 'invoice.send', { id: sent.id, number: sent.number, totalCents: sent.totalCents });
    res.json({ number: sent.number });
  }),
);

billingRouter.post(
  '/billing/invoices/:id/payments',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const body = paymentBody.parse(req.body);
    await assertOpenPeriod(body.receivedOn);
    const inv = await recordPayment(id, p.adminId, body);
    await audit(p.adminId, inv.tenantId, 'invoice.payment', { id, ...body });
    res.status(201).json({ status: inv.status, paidCents: inv.paidCents });
  }),
);

billingRouter.post(
  '/billing/invoices/:id/void',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const inv = await db().invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    const outcome = await voidInvoice(id, reason);
    await audit(p.adminId, inv.tenantId, outcome === 'deleted' ? 'invoice.discard' : 'invoice.void', { id, number: inv.number, reason });
    res.json({ outcome });
  }),
);
