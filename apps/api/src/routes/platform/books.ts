/**
 * FH Dev console: pre-authorized debits for plan charges, and FH's own books
 * (chart of accounts, journal, reports, credits and write-offs).
 */
import { Router } from 'express';
import { z } from 'zod';
import { platformOf } from '../../auth/platform.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import {
  addManualEntry,
  adjustBody,
  adjustInvoice,
  arAging,
  books,
  chart,
  chartBody,
  incomeStatement,
  journal,
  journalCsv,
  manualBody,
  revenueReport,
  salesTax,
  saveChart,
  saveSettings,
  settingsBody,
  trialBalance,
} from '../../services/billing/books.js';
import {
  agreementBody,
  agreementTerms,
  agreementView,
  batchFile,
  batches,
  cancelAgreement,
  createAgreement,
  createBatch,
  debitable,
  discardBatch,
  markSent,
  originatorBody,
  originatorView,
  returnDebit,
  saveOriginator,
  settleBatch,
} from '../../services/billing/pad.js';
import { forgetFeatures } from '../../services/platform/features.js';
import { h } from '../context.js';

export const booksRouter = Router();
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);

async function audit(adminId: string, tenantId: string | null, action: string, detail?: object) {
  await db().platformAudit.create({ data: { adminId, tenantId, action, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });
}

// ------------------------------------------------------------------ PAD agreements
booksRouter.get(
  '/billing/pad/:tenantId',
  h(async (req, res) => {
    const tenantId = uuid.parse(req.params.tenantId);
    const rows = await db().padAgreement.findMany({ where: { tenantId }, orderBy: { authorizedAt: 'desc' } });
    res.json({ active: rows.find((r) => r.status === 'ACTIVE') ? agreementView(rows.find((r) => r.status === 'ACTIVE')!) : null, history: rows.filter((r) => r.status !== 'ACTIVE').map(agreementView), terms: agreementTerms('en-CA') });
  }),
);

/** Entered from the city's signed paper form, which FH keeps on file. */
booksRouter.post(
  '/billing/pad/:tenantId',
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.tenantId);
    const body = agreementBody.extend({ formOnFile: z.literal(true, { message: 'Confirm the signed agreement is on file.' }) }).parse(req.body);
    const a = await createAgreement(tenantId, body, 'DEV_CONSOLE', p.adminId);
    await audit(p.adminId, tenantId, 'pad.agreement', { id: a.id, account: `${body.institution}-${body.transit} •••${body.account.slice(-4)}`, signer: body.signerName });
    forgetFeatures(tenantId);
    res.status(201).json(agreementView(a));
  }),
);

booksRouter.post(
  '/billing/pad/agreements/:id/cancel',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const a = await db().padAgreement.findUnique({ where: { id } });
    if (!a) throw notFound('Agreement');
    await cancelAgreement(id, reason);
    await audit(p.adminId, a.tenantId, 'pad.cancel', { id, reason });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ FH's bank details for debit files
booksRouter.get('/billing/pad-originator', h(async (_req, res) => res.json(await originatorView())));
booksRouter.put(
  '/billing/pad-originator',
  h(async (req, res) => {
    const p = platformOf(req);
    const body = originatorBody.parse(req.body);
    await saveOriginator(body);
    await audit(p.adminId, null, 'pad.originator', { originatorId: body.originatorId, dataCentre: body.dataCentre, accountChanged: !!body.returns.account });
    res.json(await originatorView());
  }),
);

// ------------------------------------------------------------------ Debit batches
booksRouter.get(
  '/billing/pad-debits',
  h(async (req, res) => {
    const d = date.parse(req.query.date ?? today());
    res.json({ date: d, invoices: await debitable(d), batches: await batches() });
  }),
);

booksRouter.post(
  '/billing/pad-batches',
  h(async (req, res) => {
    const p = platformOf(req);
    const b = z.object({ debitDate: date, invoiceIds: z.array(uuid).max(500).nullable().default(null) }).parse(req.body);
    const batch = await createBatch(b.debitDate, b.invoiceIds, p.adminId);
    await audit(p.adminId, null, 'pad.batch', { id: batch.id, fileNumber: batch.fileNumber, count: batch.count, totalCents: batch.totalCents });
    res.status(201).json({ id: batch.id, fileNumber: batch.fileNumber, count: batch.count, totalCents: batch.totalCents });
  }),
);

booksRouter.get(
  '/billing/pad-batches/:id/file',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const f = await batchFile(id);
    await audit(p.adminId, null, 'pad.file', { id, name: f.name });
    res.setHeader('Content-Type', 'text/plain; charset=us-ascii');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(f.content);
  }),
);

booksRouter.post(
  '/billing/pad-batches/:id/sent',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    await markSent(id);
    await audit(p.adminId, null, 'pad.sent', { id });
    res.json({ ok: true });
  }),
);

booksRouter.delete(
  '/billing/pad-batches/:id',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    await discardBatch(id);
    await audit(p.adminId, null, 'pad.discard', { id });
    res.json({ ok: true });
  }),
);

booksRouter.post(
  '/billing/pad-batches/:id/settle',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { settledOn } = z.object({ settledOn: date }).parse(req.body);
    await settleBatch(id, settledOn, p.adminId);
    await audit(p.adminId, null, 'pad.settle', { id, settledOn });
    res.json({ ok: true });
  }),
);

booksRouter.post(
  '/billing/pad-debits/:id/return',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ reason: z.string().trim().min(2).max(80), returnedOn: date }).parse(req.body);
    const tenantId = await returnDebit(id, b.reason, b.returnedOn, p.adminId);
    await audit(p.adminId, tenantId, 'pad.return', { id, ...b });
    forgetFeatures(tenantId);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ Credits and write-offs
for (const [path, kind] of [['credit', 'CREDIT'], ['write-off', 'WRITE_OFF']] as const) {
  booksRouter.post(
    `/billing/invoices/:id/${path}`,
    h(async (req, res) => {
      const p = platformOf(req);
      const id = uuid.parse(req.params.id);
      const body = adjustBody.parse(req.body);
      const inv = await adjustInvoice(id, kind, body, p.adminId);
      await audit(p.adminId, inv.tenantId, `invoice.${path}`, { id, ...body });
      forgetFeatures(inv.tenantId);
      res.json({ status: inv.status, paidCents: inv.paidCents });
    }),
  );
}

// ------------------------------------------------------------------ Books
booksRouter.get(
  '/books',
  h(async (_req, res) => {
    const [b, c] = await Promise.all([books(), chart()]);
    res.json({ accounts: c.accounts, byKey: c.byKey, fiscalYearStart: b.fiscalYearStart, closedThrough: b.closedThrough?.toISOString().slice(0, 10) ?? null, custom: ((b.accounts ?? {}) as { custom?: unknown[] }).custom ?? [] });
  }),
);
booksRouter.put(
  '/books/chart',
  h(async (req, res) => {
    const p = platformOf(req);
    const body = chartBody.parse(req.body);
    await saveChart(body);
    await audit(p.adminId, null, 'books.chart', body);
    res.json({ ok: true });
  }),
);
booksRouter.put(
  '/books/settings',
  h(async (req, res) => {
    const p = platformOf(req);
    const body = settingsBody.parse(req.body);
    await saveSettings(body);
    await audit(p.adminId, null, 'books.settings', body);
    res.json({ ok: true });
  }),
);

const range = (q: Record<string, unknown>) => {
  const y = new Date().getUTCFullYear();
  return z.object({ from: date.default(`${y}-01-01`), to: date.default(today()) }).parse(q);
};

booksRouter.get(
  '/books/journal.csv',
  h(async (req, res) => {
    const { from, to } = range(req.query);
    const [entries, c] = await Promise.all([journal(from, to), chart()]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fh-journal-${from}-to-${to}.csv"`);
    res.send(journalCsv(entries, c.accounts));
  }),
);
booksRouter.get(
  '/books/journal',
  h(async (req, res) => {
    const { from, to } = range(req.query);
    const entries = await journal(from, to);
    res.json({ from, to, entries, manual: await db().fhJournalEntry.findMany({ where: { date: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) } }, select: { id: true, reference: true } }) });
  }),
);
booksRouter.post(
  '/books/entries',
  h(async (req, res) => {
    const p = platformOf(req);
    const body = manualBody.parse(req.body);
    const e = await addManualEntry(body, p.adminId);
    await audit(p.adminId, null, 'books.entry', { id: e.id, ...body });
    res.status(201).json({ id: e.id });
  }),
);
/** Entries are never edited or deleted; a mistake is reversed by an opposite entry. */
booksRouter.post(
  '/books/entries/:id/reverse',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { date: on } = z.object({ date }).parse(req.body);
    const e = await db().fhJournalEntry.findUnique({ where: { id } });
    if (!e) throw notFound('Entry');
    const lines = (e.lines as Array<{ account: string; debitCents: number; creditCents: number }>).map((l) => ({ account: l.account, debitCents: l.creditCents, creditCents: l.debitCents }));
    const r = await addManualEntry({ date: on, memo: `Reversal: ${e.memo}`.slice(0, 200), reference: `REV-${e.reference ?? id.slice(0, 6)}`.slice(0, 40), lines }, p.adminId);
    await audit(p.adminId, null, 'books.reverse', { id, reversal: r.id });
    res.status(201).json({ id: r.id });
  }),
);

booksRouter.get('/books/trial-balance', h(async (req, res) => res.json(await trialBalance(date.parse(req.query.asOf ?? today())))));
booksRouter.get('/books/income-statement', h(async (req, res) => { const { from, to } = range(req.query); res.json(await incomeStatement(from, to)); }));
booksRouter.get('/books/aging', h(async (req, res) => res.json(await arAging(date.parse(req.query.asOf ?? today())))));
booksRouter.get('/books/sales-tax', h(async (req, res) => { const { from, to } = range(req.query); res.json(await salesTax(from, to)); }));
booksRouter.get('/books/revenue', h(async (req, res) => res.json(await revenueReport(z.coerce.number().int().min(2020).max(2100).parse(req.query.year ?? new Date().getUTCFullYear())))));
