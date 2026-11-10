/**
 * FH's invoices to organizations: drafts from the subscription, sent with a
 * sequential number, paid by recorded payments. Amounts are whole cents (CAD).
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { appUrl } from '../../auth/authTokens.js';
import { config } from '../../config.js';
import { db, withTenant } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { type Line, lineLabel, monthlyLines, staffUsage } from './pricing.js';
import { type Terms, invoiceLinesFor, termSummary } from './terms.js';
import { ITEM_KEYS, type ItemKey, PUBLIC_PLANS, readChoices, standardCents, standardItems } from './catalog.js';
import { SALES_TAX, taxFor } from './tax.js';
import { forgetFeatures } from '../platform/features.js';

const PROVINCES = Object.keys(SALES_TAX) as [string, ...string[]];

export const accountBody = z.object({
  plan: z.enum(['MUNICIPAL', 'CLUB']),
  legalName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).nullable(),
  email: z.string().email().max(160),
  addressLine1: z.string().trim().max(160).nullable(),
  addressLine2: z.string().trim().max(160).nullable(),
  city: z.string().trim().max(80).nullable(),
  province: z.enum(PROVINCES),
  postalCode: z.string().trim().max(10).nullable(),
  poNumber: z.string().trim().max(60).nullable(),
  paymentTermsDays: z.number().int().min(0).max(120),
  taxExempt: z.boolean(),
  taxExemptNote: z.string().trim().max(200).nullable(),
  level: z.enum(['SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE']),
  /** The quoted rate per standard facility (Multi-complex and Enterprise); null = the list price. */
  quotedRateCents: z.number().int().min(0).max(10_000_000).nullable(),
  /** Quoted staff allowance (Multi-complex); null = per facility. */
  includedStaff: z.number().int().min(0).max(100_000).nullable().optional(),
  /** Extra staff places added to the plan, billed every month. */
  extraStaffSeats: z.number().int().min(0).max(100_000).optional(),
  /** How often fixed charges are invoiced: monthly, yearly in advance, or the whole term in advance. */
  billingCycle: z.enum(['MONTHLY', 'ANNUAL', 'TERM']).optional(),
  /** Committed term in months (e.g. 12, 36, 60); null = month to month. */
  termMonths: z.number().int().min(1).max(120).nullable().optional(),
  /** YYYY-MM-DD: first day of the term (moved to the first of its month). */
  termStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Commitment discount in percent; null = the standard for the term. */
  discountPercent: z.number().min(0).max(50).nullable().optional(),
  /** Every option's state for this organization: on or off, and its price (null = standard). */
  items: z.partialRecord(z.enum(ITEM_KEYS as [ItemKey, ...ItemKey[]]), z.object({ on: z.boolean(), cents: z.number().int().min(0).max(10_000_000).nullable() })).default({}),
  clubUserRateCents: z.number().int().min(0).max(10_000),
  notes: z.string().trim().max(1000).nullable(),
  /** YYYY-MM-DD: every feature is on until the end of that day. */
  trialEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  graceDays: z.number().int().min(0).max(180).optional(),
  /** YYYY-MM-DD: don't suspend before the end of that day. */
  suspensionHoldUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredPayment: z.enum(['INVOICE', 'CARD', 'PAD']).optional(),
  facilities: z.array(z.object({ id: z.string().uuid(), tier: z.number().int().min(1).max(3).nullable(), customCents: z.number().int().min(0).max(10_000_000).nullable() })).max(100),
});
export type AccountInput = z.infer<typeof accountBody>;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('Use a month like 2026-11.');
  const start = day(`${month}-01`);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end: new Date(next.getTime() - 86_400_000), next };
}

/** People who had a published shift or a punch in the period: "active" for club pricing. */
async function activeUsers(tenantId: string, from: Date, to: Date) {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(DISTINCT u)::bigint AS n FROM (
        SELECT "userId" AS u FROM "Shift" WHERE "userId" IS NOT NULL AND status = 'PUBLISHED' AND "startsAt" >= ${from} AND "startsAt" < ${to}
        UNION SELECT "userId" FROM "TimePunch" WHERE "clockIn" >= ${from} AND "clockIn" < ${to}
      ) x`;
    return Number(r[0]?.n ?? 0);
  });
}

export async function getAccount(tenantId: string) {
  const [account, facilities, tenant] = await Promise.all([
    db().billingAccount.findUnique({ where: { tenantId } }),
    withTenant(tenantId, (tx) => tx.facility.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, province: true, billingTier: true, billingMonthlyCents: true } })),
    withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, defaultLocale: true, subdomain: true } })),
  ]);
  if (!tenant) throw notFound('Organization');
  return { tenant, account, facilities };
}

/** This month's lines, tax and total for an organization, from its billing account. */
export async function estimate(tenantId: string, month: string) {
  const { tenant, account, facilities } = await getAccount(tenantId);
  if (!account) return null;
  const { start, next } = monthBounds(month);
  const users = await activeUsers(tenantId, start, next);
  const input = {
      plan: account.plan,
      facilities: facilities.map((f) => ({ name: f.name, tier: f.billingTier, customCents: f.billingMonthlyCents })),
      activeUsers: users,
      clubUserRateCents: account.clubUserRateCents,
      level: account.level,
      quotedRateCents: account.quotedRateCents,
      includedStaff: account.includedStaff,
      extraStaffSeats: account.extraStaffSeats,
      items: account.items,
  };
  const label = lineLabel(tenant.defaultLocale);
  const monthly = monthlyLines(input, label);
  // This month's invoice under the account's terms: prepaid months of fixed charges, usage, the discount.
  const terms = termsOf(account);
  const { lines, prepaid, periodEnd } = invoiceLinesFor(monthly, terms, start, label);
  return { ...totals(lines, account.province, account.taxExempt), lines, monthlyLines: monthly, prepaidMonths: prepaid, periodEnd, activeUsers: users, staff: staffUsage(input), term: termSummary(monthly, terms, start) };
}

export const termsOf = (a: { billingCycle: Terms['billingCycle']; termMonths: number | null; termStart: Date | null; discountPercent: Prisma.Decimal | number | null }): Terms => ({
  billingCycle: a.billingCycle,
  termMonths: a.termMonths,
  termStart: a.termStart,
  discountPercent: a.discountPercent === null ? null : Number(a.discountPercent),
});

export function totals(lines: Array<Pick<Line, 'amountCents'>>, province: string, exempt: boolean) {
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxLines = taxFor(province, subtotalCents, exempt);
  return { subtotalCents, taxLines, totalCents: subtotalCents + taxLines.reduce((s, t) => s + t.amountCents, 0) };
}

export async function saveAccount(tenantId: string, body: AccountInput) {
  const { facilities, trialEndsOn, suspensionHoldUntil, termStart, ...rest } = body;
  // A term starts on the first of its month; yearly or whole-term billing needs a start.
  const start = termStart === undefined ? undefined : termStart === null ? null : day(`${termStart.slice(0, 7)}-01`);
  if (rest.billingCycle === 'TERM' && !rest.termMonths) throw badRequest('Choose the term length to invoice the whole term.');
  if (rest.billingCycle && rest.billingCycle !== 'MONTHLY' && start === null) throw badRequest('Choose when the term starts.');
  // A quoted rate only for plans priced after a quote; public-sector extras only where the plan lacks them.
  if (!PUBLIC_PLANS[rest.level].quoted) rest.quotedRateCents = null;
  if (!PUBLIC_PLANS[rest.level].quoted || PUBLIC_PLANS[rest.level].staffPerFacility === null) rest.includedStaff = null;
  if (rest.plan === 'MUNICIPAL' && PUBLIC_PLANS[rest.level].staffPerFacility === null) rest.extraStaffSeats = 0;
  // Keep only what differs from the plan: a switch away from its standard, or a price of its own.
  const std = standardItems(rest.plan, rest.level);
  const choices: Record<string, { on?: boolean; cents?: number }> = {};
  for (const [k, v] of Object.entries(rest.items) as Array<[ItemKey, { on: boolean; cents: number | null }]>) {
    const c: { on?: boolean; cents?: number } = {};
    if (v.on !== std.includes(k)) c.on = v.on;
    if (v.cents !== null && v.cents !== standardCents(rest.plan, k)) c.cents = v.cents;
    if (Object.keys(c).length) choices[k] = c;
  }
  const data0 = { ...rest, items: readChoices(choices) };
  const endOfDay = (d: string | null | undefined) => (d === undefined ? undefined : d === null ? null : new Date(`${d}T23:59:59.999Z`));
  const data = { ...data0, ...(start !== undefined ? { termStart: start } : {}), trialEndsAt: endOfDay(trialEndsOn), suspensionHoldUntil: endOfDay(suspensionHoldUntil) };
  await withTenant(tenantId, async (tx) => {
    for (const f of facilities) {
      const updated = await tx.facility.updateMany({ where: { id: f.id }, data: { billingTier: f.tier, billingMonthlyCents: f.customCents } });
      if (!updated.count) throw notFound('Facility');
    }
  });
  await db().billingAccount.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  forgetFeatures(tenantId);
}

const billToOf = (a: NonNullable<Awaited<ReturnType<typeof getAccount>>['account']>) => ({
  legalName: a.legalName,
  contactName: a.contactName,
  email: a.email,
  address: [a.addressLine1, a.addressLine2, [a.city, a.province, a.postalCode].filter(Boolean).join(' ')].filter(Boolean),
  province: a.province,
  taxExempt: a.taxExempt,
  taxExemptNote: a.taxExemptNote,
});

/** One draft per organization per month; an existing non-void invoice for that month is left alone. */
export async function generateDraft(tenantId: string, month: string, adminId: string): Promise<'created' | 'exists' | 'no-account' | 'nothing-to-bill'> {
  const { start, end } = monthBounds(month);
  const est = await estimate(tenantId, month);
  if (!est) return 'no-account';
  if (!est.lines.length) return 'nothing-to-bill';
  const { account } = await getAccount(tenantId);
  const existing = await db().invoice.findFirst({ where: { tenantId, periodStart: start, status: { not: 'VOID' } } });
  if (existing) return 'exists';
  await db().invoice.create({
    data: {
      tenantId,
      periodStart: start,
      // A prepaid invoice covers its months (a year, or the whole term).
      periodEnd: est.prepaidMonths > 1 ? est.periodEnd : end,
      subtotalCents: est.subtotalCents,
      taxLines: est.taxLines as unknown as Prisma.InputJsonValue,
      totalCents: est.totalCents,
      billTo: billToOf(account!),
      poNumber: account!.poNumber,
      createdById: adminId,
      lines: { create: est.lines.map((l, i) => ({ position: i, kind: l.kind, description: l.description, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents })) },
    },
  });
  return 'created';
}

export const draftPatch = z.object({
  lines: z.array(z.object({ kind: z.enum(['facility', 'club_base', 'club_users', 'addon_hr', 'addon_ops', 'credit', 'other']).optional(), description: z.string().trim().min(1).max(200), quantity: z.number().min(0.01).max(100_000), unitCents: z.number().int().min(-100_000_000).max(100_000_000) })).min(1).max(50).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  poNumber: z.string().trim().max(60).nullable().optional(),
});

export async function updateDraft(id: string, patch: z.infer<typeof draftPatch>) {
  const inv = await db().invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'Only drafts can be changed. Void it and issue a new one.');
  const bill = inv.billTo as { province: string; taxExempt: boolean };
  await db().$transaction(async (tx) => {
    if (patch.lines) {
      // Each line keeps its kind (it decides the revenue account): given, or the one at the same position, or a credit if negative.
      const before = await tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { position: 'asc' } });
      const lines = patch.lines.map((l, i) => ({ position: i, kind: l.unitCents < 0 ? 'credit' : (l.kind ?? before[i]?.kind ?? 'other'), description: l.description, quantity: l.quantity, unitCents: l.unitCents, amountCents: Math.round(l.quantity * l.unitCents) }));
      const t = totals(lines, bill.province, bill.taxExempt);
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.createMany({ data: lines.map((l) => ({ ...l, invoiceId: id })) });
      await tx.invoice.update({ where: { id }, data: { subtotalCents: t.subtotalCents, taxLines: t.taxLines as unknown as Prisma.InputJsonValue, totalCents: t.totalCents } });
    }
    await tx.invoice.update({ where: { id }, data: { ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.poNumber !== undefined ? { poNumber: patch.poNumber } : {}) } });
  });
}

/** Finalizes: next number in sequence for the year, issue and due dates, then emails the billing contact. */
export async function sendInvoice(id: string) {
  const inv = await db().invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'This invoice was already sent.');
  const account = await db().billingAccount.findUnique({ where: { tenantId: inv.tenantId } });
  if (!account) throw badRequest('Set up the billing account first.');
  const today = new Date();
  const year = today.getUTCFullYear();
  const sent = await db().$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ last: number }>>`
      INSERT INTO "InvoiceCounter" (year, last) VALUES (${year}, 1)
      ON CONFLICT (year) DO UPDATE SET last = "InvoiceCounter".last + 1 RETURNING last`;
    const number = `FH-${year}-${String(row!.last).padStart(4, '0')}`;
    const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + account.paymentTermsDays));
    return tx.invoice.update({ where: { id }, data: { number, status: 'SENT', issueDate: day(isoDay(today)), dueDate: due, sentAt: today, billTo: billToOf(account) } });
  });
  const tenant = await withTenant(inv.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } }));
  // For organizations paying by pre-authorized debit, the invoice is also the debit notice.
  const pad = await db().padAgreement.findFirst({ where: { tenantId: inv.tenantId, status: 'ACTIVE' } });
  await withTenant(inv.tenantId, (tx) =>
    tx.emailOutbox.create({
      data: {
        tenantId: inv.tenantId,
        toEmail: account.email,
        template: 'invoice',
        locale: tenant.defaultLocale,
        params: {
          number: sent.number,
          organization: account.legalName,
          total: money(sent.totalCents, tenant.defaultLocale),
          dueDate: isoDay(sent.dueDate!),
          period: `${isoDay(sent.periodStart)} – ${isoDay(sent.periodEnd)}`,
          from: config().BILLING_LEGAL_NAME,
          remittance: config().BILLING_REMITTANCE,
          contact: config().BILLING_EMAIL,
          url: appUrl(tenant.subdomain, ''),
          ...(pad ? { padAccount: `${pad.institution}-${pad.transit} •••${pad.accountLast4}` } : {}),
        },
      },
    }),
  );
  forgetFeatures(sent.tenantId);
  return sent;
}

export const money = (cents: number, locale = 'en-CA') => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);

export const paymentBody = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['EFT', 'CHEQUE', 'CARD', 'PAD', 'OTHER']),
  reference: z.string().trim().max(120).nullable().optional(),
});

export async function recordPayment(id: string, adminId: string | null, p: z.infer<typeof paymentBody>) {
  const out = await db().$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'SENT') throw conflict('NOT_PAYABLE', inv.status === 'DRAFT' ? 'Send the invoice before recording payments.' : 'This invoice is closed.');
    if (inv.paidCents + p.amountCents > inv.totalCents) throw new HttpError(400, 'OVERPAYMENT', 'That is more than the balance owing.');
    await tx.invoicePayment.create({ data: { invoiceId: id, amountCents: p.amountCents, receivedOn: day(p.receivedOn), method: p.method, reference: p.reference ?? null, recordedById: adminId ?? ONLINE_PAYMENT_ACTOR } });
    const paid = inv.paidCents + p.amountCents;
    return tx.invoice.update({ where: { id }, data: { paidCents: paid, ...(paid >= inv.totalCents ? { status: 'PAID', paidAt: new Date() } : {}) } });
  });
  // Paying can lift a warning or a suspension right away.
  forgetFeatures(out.tenantId);
  return out;
}

/** Payments that arrive by themselves (card or debit through the payment provider). */
export const ONLINE_PAYMENT_ACTOR = '00000000-0000-0000-0000-000000000000';

export async function voidInvoice(id: string, reason: string) {
  const inv = await db().invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'PAID' || inv.status === 'VOID' || inv.paidCents > 0) throw conflict('NOT_VOIDABLE', 'Paid or partly paid invoices can’t be voided; issue a credit instead.');
  if (inv.status === 'DRAFT') {
    await db().invoice.delete({ where: { id } }); // never numbered: nothing to keep
    return 'deleted' as const;
  }
  await db().invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
  forgetFeatures(inv.tenantId);
  return 'voided' as const;
}

/** SENT invoices past due and not fully paid read as OVERDUE; part-paid as PARTIAL. */
export function displayStatus(inv: { status: string; dueDate: Date | null; paidCents: number; totalCents: number }, today = new Date()) {
  if (inv.status !== 'SENT') return inv.status;
  if (inv.dueDate && isoDay(inv.dueDate) < isoDay(today)) return 'OVERDUE';
  return inv.paidCents > 0 ? 'PARTIAL' : 'SENT';
}
