/**
 * The organization's own billing: plan, invoices, and paying them (card or
 * pre-authorized debit online, or EFT and cheque by remittance).
 */
import express, { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { billingContact, config } from '../config.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { catalog, itemStates } from '../services/billing/catalog.js';
import { planRate } from '../services/billing/pricing.js';
import { ONLINE_PAYMENT_ACTOR, displayStatus, estimate, recordPayment, remittanceFor } from '../services/billing/invoices.js';
import { createCheckout, onlinePaymentsEnabled, verifyWebhook } from '../services/billing/stripe.js';
import { activeAgreement, agreementBody, agreementTerms, agreementView, cancelAgreement, createAgreement } from '../services/billing/pad.js';
import { audit, db, withTenant } from '../lib/db.js';
import { tenantSettings } from '../services/platform/features.js';
import { appUrl } from '../auth/authTokens.js';
import { h, subdomainOf } from './context.js';

export const billingRouter = Router();
const uuid = z.string().uuid();
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function invoiceOf(tenantId: string, id: string) {
  const inv = await db().invoice.findFirst({ where: { id, tenantId, status: { not: 'DRAFT' } }, include: { lines: { orderBy: { position: 'asc' } }, payments: { orderBy: { receivedOn: 'asc' } } } });
  if (!inv) throw notFound('Invoice');
  return inv;
}

billingRouter.get(
  '/billing',
  requirePermission('billing.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const [acct, invoices, settings] = await Promise.all([
      db().billingAccount.findUnique({ where: { tenantId: a.tenantId } }),
      // Drafts are FH's work in progress; the organization sees invoices once sent.
      db().invoice.findMany({ where: { tenantId: a.tenantId, status: { not: 'DRAFT' } }, orderBy: { issueDate: 'desc' }, take: 36 }),
      tenantSettings(a.tenantId),
    ]);
    const pad = acct ? await activeAgreement(a.tenantId) : null;
    res.json({
      state: settings.billing,
      plan: acct ? { legalName: acct.legalName, plan: acct.plan, level: acct.level, rateCents: acct.plan === 'MUNICIPAL' ? planRate(acct.level, acct.quotedRateCents) : null, items: itemStates(acct), paymentTermsDays: acct.paymentTermsDays, preferredPayment: acct.preferredPayment, poNumber: acct.poNumber } : null,
      catalog: catalog(),
      // This month's staff against the plan: what's included, places added, and anyone over.
      ...(await (async () => {
        const est = acct ? await estimate(a.tenantId, new Date().toISOString().slice(0, 7)) : null;
        return { staff: est?.staff ?? null, term: est?.term ?? null };
      })()),
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        status: displayStatus(i),
        periodStart: iso(i.periodStart),
        periodEnd: iso(i.periodEnd),
        issueDate: iso(i.issueDate),
        dueDate: iso(i.dueDate),
        totalCents: i.totalCents,
        paidCents: i.paidCents,
        balanceCents: i.status === 'SENT' ? i.totalCents - i.paidCents : 0,
      })),
      payment: { online: onlinePaymentsEnabled(), remittance: remittanceFor(String(req.query.lang ?? 'en-CA')), payee: config().BILLING_LEGAL_NAME, contact: billingContact() },
      pad: { agreement: pad ? agreementView(pad) : null, terms: agreementTerms(String(req.query.lang ?? 'en-CA')) },
    });
  }),
);

billingRouter.get(
  '/billing/invoices/:id',
  requirePermission('billing.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const inv = await invoiceOf(a.tenantId, uuid.parse(req.params.id));
    res.json({
      id: inv.id,
      number: inv.number,
      status: displayStatus(inv),
      periodStart: iso(inv.periodStart),
      periodEnd: iso(inv.periodEnd),
      issueDate: iso(inv.issueDate),
      dueDate: iso(inv.dueDate),
      subtotalCents: inv.subtotalCents,
      taxLines: inv.taxLines,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      balanceCents: inv.status === 'SENT' ? inv.totalCents - inv.paidCents : 0,
      billTo: inv.billTo,
      poNumber: inv.poNumber,
      notes: inv.notes,
      lines: inv.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitCents: l.unitCents, amountCents: l.amountCents })),
      payments: inv.payments.map((p) => ({ amountCents: p.amountCents, receivedOn: iso(p.receivedOn), method: p.method })),
    });
  }),
);

/** Opens Stripe's payment page for what's still owing on an invoice. */
billingRouter.post(
  '/billing/invoices/:id/checkout',
  requirePermission('billing.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const { method } = z.object({ method: z.enum(['card', 'pad']) }).parse(req.body);
    const inv = await invoiceOf(a.tenantId, uuid.parse(req.params.id));
    if (inv.status !== 'SENT' || inv.paidCents >= inv.totalCents) throw conflict('NOT_PAYABLE', 'This invoice has nothing left to pay.');
    const [acct, me] = await Promise.all([db().billingAccount.findUnique({ where: { tenantId: a.tenantId } }), db().user.findUnique({ where: { id: a.userId }, select: { email: true, locale: true } })]);
    const back = (q: string) => `${appUrl(subdomainOf(req) ?? '', '/manage/billing')}?${q}`;
    const session = await createCheckout({
      invoiceId: inv.id,
      tenantId: a.tenantId,
      number: inv.number ?? inv.id,
      amountCents: inv.totalCents - inv.paidCents,
      email: acct?.email ?? me?.email ?? '',
      method,
      locale: me?.locale ?? 'en-CA',
      successUrl: back(`paid=${inv.id}`),
      cancelUrl: back('cancelled=1'),
    });
    await db().invoice.update({ where: { id: inv.id }, data: { checkoutId: session.id } });
    res.json({ url: session.url });
  }),
);

interface StripeEvent { id: string; type: string; data: { object: { id: string; payment_status?: string; amount_total?: number; payment_intent?: string; metadata?: Record<string, string>; payment_method_types?: string[] } } }

/**
 * Stripe → us. Mounted with a raw body, before JSON parsing, and outside
 * sign-in: the signature is the authentication. Records each payment once.
 */
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post(
  '/billing/stripe/webhook',
  express.raw({ type: 'application/json', limit: '512kb' }),
  h(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(404, 'NOT_FOUND', 'Not configured');
    const event = verifyWebhook(req.body as Buffer, req.header('stripe-signature'), secret) as StripeEvent;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      const invoiceId = s.metadata?.invoiceId;
      // PAD settles days later (async_payment_succeeded); only record money that has arrived.
      if (invoiceId && s.payment_status === 'paid' && s.amount_total) {
        const reference = s.payment_intent ?? s.id;
        const seen = await db().invoicePayment.findFirst({ where: { invoiceId, reference } });
        if (!seen) {
          const inv = await db().invoice.findUnique({ where: { id: invoiceId } });
          if (inv && inv.status === 'SENT') {
            const amount = Math.min(s.amount_total, inv.totalCents - inv.paidCents);
            if (amount > 0) {
              await recordPayment(invoiceId, null, { amountCents: amount, receivedOn: new Date().toISOString().slice(0, 10), method: s.payment_method_types?.includes('acss_debit') ? 'PAD' : 'CARD', reference });
              await db().platformAudit.create({ data: { adminId: ONLINE_PAYMENT_ACTOR, tenantId: inv.tenantId, action: 'invoice.payment.online', detail: { invoiceId, amountCents: amount, reference } } });
            }
          }
        }
      }
    }
    res.json({ received: true });
  }),
);

/** The billing administrator authorizes FH to debit the city's account for each invoice (business PAD). */
billingRouter.post(
  '/billing/pad',
  requirePermission('billing.manage'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const body = agreementBody.parse(req.body);
    const created = await createAgreement(a.tenantId, body, 'ORGANIZATION', a.userId);
    await withTenant(a.tenantId, (tx) => audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'billing.pad.authorize', entity: 'PadAgreement', entityId: created.id, after: { account: `${body.institution}-${body.transit} •••${body.account.slice(-4)}`, signer: body.signerName, title: body.signerTitle } }));
    res.status(201).json(agreementView(created));
  }),
);

billingRouter.post(
  '/billing/pad/cancel',
  requirePermission('billing.manage'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const current = await activeAgreement(a.tenantId);
    if (!current) throw notFound('Agreement');
    await cancelAgreement(current.id, reason);
    await withTenant(a.tenantId, (tx) => audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'billing.pad.cancel', entity: 'PadAgreement', entityId: current.id, after: { reason } }));
    res.json({ ok: true });
  }),
);
