/**
 * FH's own books for plan charges: a double-entry general ledger built from
 * billing activity, plus the accountant's manual entries.
 *
 * - Invoice sent: Dr accounts receivable / Cr revenue (by kind of line) and Cr
 *   each sales tax payable. A voided invoice is reversed on the day it's voided.
 * - Payment (EFT, cheque, card, PAD): Dr bank / Cr receivable. A returned PAD
 *   debit is the reverse.
 * - Credit note: Dr credits and discounts plus the tax it carried / Cr receivable.
 * - Write-off: Dr bad debts plus the tax it carried (GST/HST bad-debt relief) / Cr receivable.
 *
 * Reports: journal (and CSV), trial balance, income statement, receivables
 * aging, sales tax to remit, and revenue by month and organization. Entries
 * dated on or before the "closed through" date can't be added.
 *
 * Amounts are whole cents. VERIFY the chart and tax treatment with FH's accountant.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, tenantIds, withTenant } from '../../lib/db.js';
import { HttpError, badRequest, notFound } from '../../lib/errors.js';
import { csvCell } from '../payroll/export.js';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export const CHART_KEYS = ['bank', 'ar', 'gstHst', 'qst', 'pst', 'equity', 'revFacility', 'revClub', 'revAddOns', 'revOther', 'credits', 'bankFees', 'badDebt'] as const;
export type ChartKey = (typeof CHART_KEYS)[number];

export const DEFAULT_CHART: Record<ChartKey, { code: string; name: string; type: AccountType }> = {
  bank: { code: '1000', name: 'Bank: operating account', type: 'ASSET' },
  ar: { code: '1200', name: 'Accounts receivable', type: 'ASSET' },
  gstHst: { code: '2300', name: 'GST/HST payable', type: 'LIABILITY' },
  qst: { code: '2310', name: 'QST payable', type: 'LIABILITY' },
  pst: { code: '2320', name: 'PST/RST payable', type: 'LIABILITY' },
  equity: { code: '3000', name: 'Retained earnings', type: 'EQUITY' },
  revFacility: { code: '4000', name: 'Subscription revenue: facility licences', type: 'REVENUE' },
  revClub: { code: '4010', name: 'Subscription revenue: club plans', type: 'REVENUE' },
  revAddOns: { code: '4020', name: 'Module and add-on revenue', type: 'REVENUE' },
  revOther: { code: '4090', name: 'Other revenue', type: 'REVENUE' },
  credits: { code: '4900', name: 'Credits and discounts', type: 'REVENUE' },
  bankFees: { code: '6100', name: 'Bank and payment fees', type: 'EXPENSE' },
  badDebt: { code: '6500', name: 'Bad debts', type: 'EXPENSE' },
};

interface StoredChart { codes?: Partial<Record<ChartKey, string>>; custom?: Array<{ code: string; name: string; type: AccountType }> }
export interface Account { code: string; name: string; type: AccountType; key: ChartKey | null }

export async function books() {
  return db().fhBooks.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function chart(): Promise<{ accounts: Account[]; byKey: Record<ChartKey, string> }> {
  const b = await books();
  const stored = (b.accounts ?? {}) as StoredChart;
  const byKey = Object.fromEntries(CHART_KEYS.map((k) => [k, stored.codes?.[k] ?? DEFAULT_CHART[k].code])) as Record<ChartKey, string>;
  const accounts: Account[] = [...CHART_KEYS.map((k) => ({ code: byKey[k], name: DEFAULT_CHART[k].name, type: DEFAULT_CHART[k].type, key: k })), ...(stored.custom ?? []).map((c) => ({ ...c, key: null }))];
  return { accounts: accounts.sort((a, b) => a.code.localeCompare(b.code)), byKey };
}

const code = z.string().regex(/^[A-Za-z0-9.-]{2,12}$/);
export const chartBody = z.object({
  codes: z.partialRecord(z.enum(CHART_KEYS), code).default({}),
  custom: z.array(z.object({ code, name: z.string().trim().min(2).max(80), type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) })).max(200).default([]),
});

export async function saveChart(input: z.infer<typeof chartBody>) {
  const codes = CHART_KEYS.map((k) => input.codes[k] ?? DEFAULT_CHART[k].code);
  const all = [...codes, ...input.custom.map((c) => c.code)];
  const dup = all.find((c, i) => all.indexOf(c) !== i);
  if (dup) throw badRequest(`Account ${dup} is used twice.`);
  await books();
  await db().fhBooks.update({ where: { id: 1 }, data: { accounts: input as unknown as Prisma.InputJsonValue } });
}

export const settingsBody = z.object({ fiscalYearStart: z.number().int().min(1).max(12), closedThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });
export async function saveSettings(input: z.infer<typeof settingsBody>) {
  await books();
  await db().fhBooks.update({ where: { id: 1 }, data: { fiscalYearStart: input.fiscalYearStart, closedThrough: input.closedThrough ? new Date(`${input.closedThrough}T00:00:00Z`) : null } });
}

/** Nothing can be dated inside a closed period. */
export async function assertOpenPeriod(date: string) {
  const b = await books();
  if (b.closedThrough && date <= isoDay(b.closedThrough)) throw new HttpError(409, 'PERIOD_CLOSED', `The books are closed through ${isoDay(b.closedThrough)}. Date it later, or reopen the period.`);
}

// ------------------------------------------------------------------ Journal
export interface Line { account: string; debitCents: number; creditCents: number }
export interface Entry { date: string; kind: 'INVOICE' | 'VOID' | 'PAYMENT' | 'PAD_RETURN' | 'CREDIT' | 'WRITE_OFF' | 'MANUAL'; reference: string; memo: string; organization: string | null; tenantId: string | null; lines: Line[] }

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
// Older invoices used addon_hr / addon_ops; new ones use module_<name>. Extra staff count with the facility licences.
const LINE_ACCOUNT: Record<string, ChartKey> = { facility: 'revFacility', extra_staff: 'revFacility', staff_seats: 'revFacility', club_base: 'revClub', club_users: 'revClub', addon_hr: 'revAddOns', addon_ops: 'revAddOns', credit: 'credits', other: 'revOther' };
const lineAccount = (kind: string): ChartKey => LINE_ACCOUNT[kind] ?? (kind.startsWith('module_') ? 'revAddOns' : 'revOther');
const taxKey = (name: string): ChartKey => (name === 'QST' ? 'qst' : name === 'PST' || name === 'RST' ? 'pst' : 'gstHst');

async function orgNames() {
  const ids = await tenantIds();
  const rows = await Promise.all(ids.map((id) => withTenant(id, (tx) => tx.tenant.findUnique({ where: { id }, select: { id: true, name: true } }))));
  return new Map(rows.filter(Boolean).map((r) => [r!.id, r!.name]));
}

/** Splits an amount that includes tax into its pre-tax part and each tax's part, in proportion to the invoice. */
export function splitWithTax(amountCents: number, inv: { subtotalCents: number; totalCents: number; taxLines: Array<{ name: string; amountCents: number }> }) {
  if (!inv.totalCents) return { preTax: amountCents, taxes: [] as Array<{ name: string; amountCents: number }> };
  const taxes = inv.taxLines.map((t) => ({ name: t.name, amountCents: Math.round((amountCents * t.amountCents) / inv.totalCents) }));
  return { preTax: amountCents - taxes.reduce((s, t) => s + t.amountCents, 0), taxes };
}

export async function journal(from: string, to: string): Promise<Entry[]> {
  const [{ byKey }, names] = await Promise.all([chart(), orgNames()]);
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T23:59:59.999Z`);
  const acct = (k: ChartKey) => byKey[k];
  const entries: Entry[] = [];

  const invoices = await db().invoice.findMany({
    where: { OR: [{ issueDate: { gte: fromD, lte: toD } }, { voidedAt: { gte: fromD, lte: toD }, issueDate: { not: null } }] },
    include: { lines: true },
  });
  for (const inv of invoices) {
    const taxLines = inv.taxLines as Array<{ name: string; amountCents: number }>;
    const lines: Line[] = [{ account: acct('ar'), debitCents: inv.totalCents, creditCents: 0 }];
    for (const l of inv.lines) {
      const a = acct(l.amountCents < 0 ? 'credits' : lineAccount(l.kind));
      lines.push(l.amountCents >= 0 ? { account: a, debitCents: 0, creditCents: l.amountCents } : { account: a, debitCents: -l.amountCents, creditCents: 0 });
    }
    for (const t of taxLines) if (t.amountCents) lines.push({ account: acct(taxKey(t.name)), debitCents: 0, creditCents: t.amountCents });
    const base = { reference: inv.number ?? inv.id.slice(0, 8), organization: names.get(inv.tenantId) ?? null, tenantId: inv.tenantId };
    if (inv.issueDate && inv.issueDate >= fromD && inv.issueDate <= toD) entries.push({ ...base, date: isoDay(inv.issueDate), kind: 'INVOICE', memo: `Invoice ${base.reference}, ${isoDay(inv.periodStart)} to ${isoDay(inv.periodEnd)}`, lines: merge(lines) });
    if (inv.voidedAt && inv.voidedAt >= fromD && inv.voidedAt <= toD) entries.push({ ...base, date: isoDay(inv.voidedAt), kind: 'VOID', memo: `Void of invoice ${base.reference}: ${inv.voidReason ?? ''}`.trim(), lines: merge(lines.map((l) => ({ account: l.account, debitCents: l.creditCents, creditCents: l.debitCents }))) });
  }

  const payments = await db().invoicePayment.findMany({ where: { receivedOn: { gte: fromD, lte: toD } }, include: { invoice: true } });
  for (const p of payments) {
    const inv = p.invoice;
    const base = { date: isoDay(p.receivedOn), reference: inv.number ?? inv.id.slice(0, 8), organization: names.get(inv.tenantId) ?? null, tenantId: inv.tenantId };
    const taxLines = inv.taxLines as Array<{ name: string; amountCents: number }>;
    if (p.method === 'CREDIT' || p.method === 'WRITE_OFF') {
      const { preTax, taxes } = splitWithTax(p.amountCents, { ...inv, taxLines });
      const lines: Line[] = [{ account: acct(p.method === 'CREDIT' ? 'credits' : 'badDebt'), debitCents: preTax, creditCents: 0 }, ...taxes.filter((t) => t.amountCents).map((t) => ({ account: acct(taxKey(t.name)), debitCents: t.amountCents, creditCents: 0 })), { account: acct('ar'), debitCents: 0, creditCents: p.amountCents }];
      entries.push({ ...base, kind: p.method, memo: `${p.method === 'CREDIT' ? 'Credit note' : 'Write-off'} on ${base.reference}${p.reference ? `: ${p.reference}` : ''}`, lines: merge(lines) });
    } else if (p.amountCents < 0) {
      entries.push({ ...base, kind: 'PAD_RETURN', memo: `Returned debit on ${base.reference}${p.reference ? `: ${p.reference}` : ''}`, lines: [{ account: acct('ar'), debitCents: -p.amountCents, creditCents: 0 }, { account: acct('bank'), debitCents: 0, creditCents: -p.amountCents }] });
    } else {
      entries.push({ ...base, kind: 'PAYMENT', memo: `Payment on ${base.reference} (${p.method}${p.reference ? `, ${p.reference}` : ''})`, lines: [{ account: acct('bank'), debitCents: p.amountCents, creditCents: 0 }, { account: acct('ar'), debitCents: 0, creditCents: p.amountCents }] });
    }
  }

  const manual = await db().fhJournalEntry.findMany({ where: { date: { gte: fromD, lte: toD } } });
  for (const m of manual) entries.push({ date: isoDay(m.date), kind: 'MANUAL', reference: m.reference ?? `JE-${m.id.slice(0, 6)}`, memo: m.memo, organization: null, tenantId: null, lines: m.lines as unknown as Line[] });

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
}

/** One debit and one credit per account, netted. */
function merge(lines: Line[]): Line[] {
  const by = new Map<string, Line>();
  for (const l of lines) {
    const x = by.get(l.account) ?? { account: l.account, debitCents: 0, creditCents: 0 };
    x.debitCents += l.debitCents;
    x.creditCents += l.creditCents;
    by.set(l.account, x);
  }
  return [...by.values()].map((l) => {
    const net = l.debitCents - l.creditCents;
    return { account: l.account, debitCents: Math.max(0, net), creditCents: Math.max(0, -net) };
  }).filter((l) => l.debitCents || l.creditCents);
}

export function journalCsv(entries: Entry[], accounts: Account[]): string {
  // Quoted, with spreadsheet formulas neutralised (a name like =HYPERLINK(...) stays text).
  const q = (v: unknown) => { const c = csvCell(String(v ?? '')); return c.startsWith('"') ? c : `"${c}"`; };
  const name = (c: string) => accounts.find((a) => a.code === c)?.name ?? '';
  const rows = entries.flatMap((e) => e.lines.map((l) => [e.date, e.reference, e.kind, l.account, name(l.account), l.debitCents ? (l.debitCents / 100).toFixed(2) : '', l.creditCents ? (l.creditCents / 100).toFixed(2) : '', e.organization ?? '', e.memo].map(q).join(',')));
  return [['Date', 'Reference', 'Type', 'Account', 'Account name', 'Debit', 'Credit', 'Organization', 'Memo'].map(q).join(','), ...rows].join('\r\n');
}

// ------------------------------------------------------------------ Manual entries
export const manualBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().min(2).max(200),
  reference: z.string().trim().max(40).nullable().optional(),
  lines: z.array(z.object({ account: code, debitCents: z.number().int().min(0).max(1e11), creditCents: z.number().int().min(0).max(1e11) })).min(2).max(30),
});

export async function addManualEntry(input: z.infer<typeof manualBody>, adminId: string) {
  await assertOpenPeriod(input.date);
  const { accounts } = await chart();
  for (const l of input.lines) {
    if (!accounts.some((a) => a.code === l.account)) throw badRequest(`Account ${l.account} isn’t in the chart of accounts.`);
    if (!!l.debitCents === !!l.creditCents) throw badRequest('Each line is either a debit or a credit.');
  }
  const dr = input.lines.reduce((s, l) => s + l.debitCents, 0);
  const cr = input.lines.reduce((s, l) => s + l.creditCents, 0);
  if (dr !== cr) throw new HttpError(400, 'UNBALANCED', `Debits (${(dr / 100).toFixed(2)}) and credits (${(cr / 100).toFixed(2)}) must be equal.`);
  return db().fhJournalEntry.create({ data: { date: new Date(`${input.date}T00:00:00Z`), memo: input.memo, reference: input.reference ?? null, lines: input.lines as unknown as Prisma.InputJsonValue, createdById: adminId } });
}

// ------------------------------------------------------------------ Credits and write-offs
export const adjustBody = z.object({ amountCents: z.number().int().min(1).max(100_000_000).optional(), reason: z.string().trim().min(3).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** A credit note (part or all of the balance) or a write-off of what's left. Either closes the invoice when nothing is owing. */
export async function adjustInvoice(id: string, kind: 'CREDIT' | 'WRITE_OFF', input: z.infer<typeof adjustBody>, adminId: string) {
  await assertOpenPeriod(input.date);
  return db().$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'SENT') throw new HttpError(409, 'NOT_OPEN', 'Only sent invoices with a balance can be credited or written off.');
    const owing = inv.totalCents - inv.paidCents;
    const amount = kind === 'WRITE_OFF' ? owing : (input.amountCents ?? owing);
    if (amount > owing) throw new HttpError(400, 'OVER_BALANCE', 'That is more than the balance owing.');
    await tx.invoicePayment.create({ data: { invoiceId: id, amountCents: amount, receivedOn: new Date(`${input.date}T00:00:00Z`), method: kind, reference: input.reason, recordedById: adminId } });
    const paid = inv.paidCents + amount;
    return tx.invoice.update({ where: { id }, data: { paidCents: paid, ...(paid >= inv.totalCents ? { status: 'PAID', paidAt: new Date() } : {}) } });
  });
}

// ------------------------------------------------------------------ Reports
export async function trialBalance(asOf: string) {
  const { accounts } = await chart();
  const entries = await journal('2000-01-01', asOf);
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const e of entries) for (const l of e.lines) {
    const t = totals.get(l.account) ?? { debitCents: 0, creditCents: 0 };
    t.debitCents += l.debitCents;
    t.creditCents += l.creditCents;
    totals.set(l.account, t);
  }
  const rows = [...totals.entries()].map(([code, t]) => {
    const a = accounts.find((x) => x.code === code);
    const net = t.debitCents - t.creditCents;
    return { code, name: a?.name ?? '(not in chart)', type: a?.type ?? null, debitCents: Math.max(0, net), creditCents: Math.max(0, -net) };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const debit = rows.reduce((s, r) => s + r.debitCents, 0);
  const credit = rows.reduce((s, r) => s + r.creditCents, 0);
  return { asOf, rows, debitCents: debit, creditCents: credit, balanced: debit === credit };
}

export async function incomeStatement(from: string, to: string) {
  const { accounts } = await chart();
  const entries = await journal(from, to);
  const net = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) net.set(l.account, (net.get(l.account) ?? 0) + l.creditCents - l.debitCents);
  const of = (type: AccountType) => accounts.filter((a) => a.type === type).map((a) => ({ code: a.code, name: a.name, cents: type === 'EXPENSE' ? -(net.get(a.code) ?? 0) : (net.get(a.code) ?? 0) })).filter((r) => r.cents);
  const revenue = of('REVENUE');
  const expenses = of('EXPENSE');
  const revenueCents = revenue.reduce((s, r) => s + r.cents, 0);
  const expenseCents = expenses.reduce((s, r) => s + r.cents, 0);
  return { from, to, revenue, expenses, revenueCents, expenseCents, netIncomeCents: revenueCents - expenseCents };
}

/** What each organization owes as of a date, by how long past due. */
export async function arAging(asOf: string) {
  const names = await orgNames();
  const end = new Date(`${asOf}T23:59:59.999Z`);
  const invoices = await db().invoice.findMany({ where: { issueDate: { lte: end }, OR: [{ voidedAt: null }, { voidedAt: { gt: end } }] }, include: { payments: true } });
  const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
  const byOrg = new Map<string, Record<(typeof buckets)[number], number> & { tenantId: string; organization: string; invoices: number }>();
  for (const inv of invoices) {
    const paid = inv.payments.filter((p) => p.receivedOn <= end).reduce((s, p) => s + p.amountCents, 0);
    const owing = inv.totalCents - paid;
    if (owing <= 0) continue;
    const late = inv.dueDate ? Math.floor((end.getTime() - inv.dueDate.getTime()) / 86_400_000) : 0;
    const b = late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'over90';
    const row = byOrg.get(inv.tenantId) ?? { tenantId: inv.tenantId, organization: names.get(inv.tenantId) ?? inv.tenantId, invoices: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    row[b] += owing;
    row.invoices += 1;
    byOrg.set(inv.tenantId, row);
  }
  const rows = [...byOrg.values()].map((r) => ({ ...r, totalCents: buckets.reduce((s, b) => s + r[b], 0) })).sort((a, b) => b.totalCents - a.totalCents);
  const totals = Object.fromEntries(buckets.map((b) => [b, rows.reduce((s, r) => s + r[b], 0)])) as Record<(typeof buckets)[number], number>;
  return { asOf, rows, totals: { ...totals, totalCents: rows.reduce((s, r) => s + r.totalCents, 0) } };
}

/** Sales tax charged in a period, net of voids, credits and write-offs: what goes on the GST/HST, QST and PST returns. */
export async function salesTax(from: string, to: string) {
  const entries = await journal(from, to);
  const { byKey } = await chart();
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T23:59:59.999Z`);
  const invoices = await db().invoice.findMany({ where: { issueDate: { gte: fromD, lte: toD } }, select: { subtotalCents: true, billTo: true, taxLines: true } });
  const byProvince = new Map<string, { province: string; salesCents: number; taxes: Record<string, number> }>();
  for (const inv of invoices) {
    const p = (inv.billTo as { province?: string }).province ?? '??';
    const row = byProvince.get(p) ?? { province: p, salesCents: 0, taxes: {} };
    row.salesCents += inv.subtotalCents;
    for (const t of inv.taxLines as Array<{ name: string; amountCents: number }>) row.taxes[t.name] = (row.taxes[t.name] ?? 0) + t.amountCents;
    byProvince.set(p, row);
  }
  const net = (key: ChartKey) => entries.reduce((s, e) => s + e.lines.filter((l) => l.account === byKey[key]).reduce((x, l) => x + l.creditCents - l.debitCents, 0), 0);
  const charged = (key: ChartKey) => entries.filter((e) => e.kind === 'INVOICE').reduce((s, e) => s + e.lines.filter((l) => l.account === byKey[key]).reduce((x, l) => x + l.creditCents, 0), 0);
  const taxes = (['gstHst', 'qst', 'pst'] as const).map((k) => ({ key: k, account: byKey[k], chargedCents: charged(k), adjustmentsCents: net(k) - charged(k), netCents: net(k) }));
  return { from, to, taxes, byProvince: [...byProvince.values()].sort((a, b) => a.province.localeCompare(b.province)), note: 'Input tax credits on FH’s own purchases are not tracked here: your accountant adds them to the return.' };
}

/** Revenue by month for a year, in total and by organization; recurring revenue from the latest month. */
export async function revenueReport(year: number) {
  const names = await orgNames();
  const { byKey, accounts } = await chart();
  const revenueCodes = new Set(accounts.filter((a) => a.type === 'REVENUE').map((a) => a.code));
  const entries = await journal(`${year}-01-01`, `${year}-12-31`);
  const months = Array.from({ length: 12 }, () => 0);
  const orgs = new Map<string, number[]>();
  for (const e of entries) {
    const cents = e.lines.filter((l) => revenueCodes.has(l.account)).reduce((s, l) => s + l.creditCents - l.debitCents, 0);
    if (!cents) continue;
    const m = Number(e.date.slice(5, 7)) - 1;
    months[m]! += cents;
    if (e.tenantId) {
      const row = orgs.get(e.tenantId) ?? Array.from({ length: 12 }, () => 0);
      row[m]! += cents;
      orgs.set(e.tenantId, row);
    }
  }
  const lastMonth = [...months].reverse().find((m) => m) ?? 0;
  return {
    year,
    months,
    totalCents: months.reduce((s, m) => s + m, 0),
    mrrCents: lastMonth,
    arrCents: lastMonth * 12,
    organizations: [...orgs.entries()].map(([tenantId, m]) => ({ tenantId, organization: names.get(tenantId) ?? tenantId, months: m, totalCents: m.reduce((s, x) => s + x, 0) })).sort((a, b) => b.totalCents - a.totalCents),
    accounts: { revenue: [byKey.revFacility, byKey.revClub, byKey.revAddOns, byKey.revOther, byKey.credits] },
  };
}
