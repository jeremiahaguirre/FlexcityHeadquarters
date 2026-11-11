/**
 * Pre-authorized debit (PAD) for plan charges: a city authorizes FH to take
 * each invoice's amount from its bank account on or after the due date
 * (a business PAD under Payments Canada Rule H1).
 *
 * - The agreement is set up by the Dev console (with the signed paper form on
 *   file) or by the organization's billing administrator in the app. Either way
 *   the billing contact gets a written confirmation.
 * - The invoice is the pre-notification: it says how much will be taken and
 *   when, at least 10 days ahead, unless the payor waived that notice.
 * - FH builds a CPA-005 debit file for its bank, then records the batch as
 *   settled (payments land on the invoices) and any returns (NSF, closed
 *   account), which put the balance back on the invoice.
 *
 * The full account number is sealed with the organization's key; FH opens it
 * only to write the bank file.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { billingContact, config } from '../../config.js';
import { db, withTenant } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { type Sealed, open, seal } from '../crypto/envelope.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { buildCpa005 } from '../payroll/cpa005.js';
import { assertOpenPeriod } from './books.js';
import { recordPayment } from './invoices.js';

export const AGREEMENT_VERSION = 'FH-PAD-BUSINESS-2026-11';
/** Default CPA transaction code for a business PAD. Confirm it with FH's bank. */
export const DEFAULT_PAD_CODE = '700';
const NOTICE_DAYS = 10;

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** The terms the payor agrees to, in their language. */
export function agreementTerms(locale: string, payee = config().BILLING_LEGAL_NAME, contact: string | null = billingContact()): string[] {
  // No address on file yet: name who to write to rather than show a placeholder.
  contact = contact || payee;
  if (locale.startsWith('fr')) {
    return [
      `Vous autorisez ${payee} à débiter le compte indiqué du montant de chaque facture d’abonnement, à la date d’échéance ou après.`,
      'Il s’agit d’un débit préautorisé d’entreprise (règle H1 de Paiements Canada). Les montants varient selon la facture.',
      `Chaque facture vous parvient au moins ${NOTICE_DAYS} jours avant le débit et en indique le montant et la date, sauf si vous renoncez à ce préavis.`,
      `Vous pouvez annuler cette autorisation en tout temps, avec un préavis de 30 jours, en écrivant à ${contact}. L’annulation ne met pas fin au contrat d’abonnement.`,
      'Vous avez certains droits de recours si un débit n’est pas conforme à cette entente, par exemple le droit d’en obtenir le remboursement. Pour en savoir plus, communiquez avec votre institution financière ou visitez paiements.ca.',
    ];
  }
  return [
    `You authorize ${payee} to debit the account below for the amount of each subscription invoice, on or after its due date.`,
    'This is a business pre-authorized debit (Payments Canada Rule H1). The amount varies with each invoice.',
    `Each invoice reaches you at least ${NOTICE_DAYS} days before the debit and states the amount and date, unless you waive that notice.`,
    `You may cancel this authorization at any time with 30 days’ notice by writing to ${contact}. Cancelling does not end the subscription agreement.`,
    'You have certain recourse rights if any debit does not comply with this agreement, for example the right to be reimbursed. For more information, contact your financial institution or visit payments.ca.',
  ];
}

export const agreementBody = z.object({
  payorName: z.string().trim().min(2).max(120),
  signerName: z.string().trim().min(2).max(120),
  signerTitle: z.string().trim().min(2).max(120),
  institution: z.string().regex(/^\d{3}$/, 'Institution numbers are 3 digits.'),
  transit: z.string().regex(/^\d{5}$/, 'Transit numbers are 5 digits.'),
  account: z.string().regex(/^\d{5,12}$/, 'Account numbers are 5 to 12 digits.'),
  waivedPreNotice: z.boolean().default(false),
  agree: z.literal(true, { message: 'The authorization has to be accepted.' }),
});

type SealedJson = { c: string; iv: string; t: string; k: string; kek: string };
const toJson = (s: Sealed): SealedJson => ({ c: s.ciphertext.toString('base64'), iv: s.iv.toString('base64'), t: s.authTag.toString('base64'), k: s.wrappedDataKey.toString('base64'), kek: s.kekId });
const fromJson = (j: SealedJson): Sealed => ({ ciphertext: Buffer.from(j.c, 'base64'), iv: Buffer.from(j.iv, 'base64'), authTag: Buffer.from(j.t, 'base64'), wrappedDataKey: Buffer.from(j.k, 'base64'), kekId: j.kek });
const padAad = (tenantId: string) => `pad:${tenantId}`;
/** FH's own bank details (where returns go) are FH's, not a city's. */
export const platformKekId = () => (config().KMS_KEY_ARN ? 'alias/flexcity-platform' : 'local:platform');

export type AgreementView = ReturnType<typeof agreementView>;
export function agreementView(a: { id: string; tenantId: string; status: string; payorName: string; signerName: string; signerTitle: string; institution: string; transit: string; accountLast4: string; waivedPreNotice: boolean; channel: string; authorizedAt: Date; cancelledAt: Date | null; cancelReason: string | null; agreementVersion: string }) {
  return {
    id: a.id,
    tenantId: a.tenantId,
    status: a.status,
    payorName: a.payorName,
    signerName: a.signerName,
    signerTitle: a.signerTitle,
    institution: a.institution,
    transit: a.transit,
    account: `•••${a.accountLast4}`,
    waivedPreNotice: a.waivedPreNotice,
    channel: a.channel,
    authorizedAt: a.authorizedAt,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
    agreementVersion: a.agreementVersion,
  };
}

export async function activeAgreement(tenantId: string) {
  return db().padAgreement.findFirst({ where: { tenantId, status: 'ACTIVE' }, orderBy: { authorizedAt: 'desc' } });
}

/** A new agreement replaces any active one. The billing contact gets the written confirmation the rules call for. */
export async function createAgreement(tenantId: string, input: z.infer<typeof agreementBody>, channel: 'DEV_CONSOLE' | 'ORGANIZATION', authorizedBy: string) {
  const account = await db().billingAccount.findUnique({ where: { tenantId } });
  if (!account) throw badRequest('Set up the billing account first.');
  const sealed = await seal(keys(), tenantKekId(tenantId), input.account, padAad(tenantId));
  const created = await db().$transaction(async (tx) => {
    await tx.padAgreement.updateMany({ where: { tenantId, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Replaced by a new agreement' } });
    const a = await tx.padAgreement.create({
      data: {
        tenantId,
        payorName: input.payorName,
        signerName: input.signerName,
        signerTitle: input.signerTitle,
        institution: input.institution,
        transit: input.transit,
        accountLast4: input.account.slice(-4),
        accountSealed: toJson(sealed) as unknown as Prisma.InputJsonValue,
        agreementVersion: AGREEMENT_VERSION,
        waivedPreNotice: input.waivedPreNotice,
        channel,
        authorizedBy,
      },
    });
    await tx.billingAccount.update({ where: { tenantId }, data: { preferredPayment: 'PAD' } });
    return a;
  });
  const tenant = await withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultLocale: true } }));
  await withTenant(tenantId, (tx) =>
    tx.emailOutbox.create({
      data: {
        tenantId,
        toEmail: account.email,
        template: 'pad_confirmation',
        locale: tenant.defaultLocale,
        params: { payee: config().BILLING_LEGAL_NAME, payor: input.payorName, signer: `${input.signerName}, ${input.signerTitle}`, account: `${input.institution}-${input.transit} •••${input.account.slice(-4)}`, date: isoDay(new Date()), contact: billingContact() ?? '', terms: agreementTerms(tenant.defaultLocale).join('\n\n') },
      },
    }),
  );
  return created;
}

export async function cancelAgreement(id: string, reason: string) {
  const a = await db().padAgreement.findUnique({ where: { id } });
  if (!a || a.status !== 'ACTIVE') throw notFound('Agreement');
  await db().$transaction([
    db().padAgreement.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } }),
    db().billingAccount.updateMany({ where: { tenantId: a.tenantId, preferredPayment: 'PAD' }, data: { preferredPayment: 'INVOICE' } }),
  ]);
}

// ------------------------------------------------------------------ FH's originator details
export const originatorBody = z.object({
  originatorId: z.string().regex(/^[A-Za-z0-9]{1,10}$/),
  dataCentre: z.string().regex(/^\d{5}$/),
  shortName: z.string().trim().min(2).max(15),
  longName: z.string().trim().min(2).max(30),
  transactionCode: z.string().regex(/^\d{3}$/).default(DEFAULT_PAD_CODE),
  returns: z.object({ institution: z.string().regex(/^\d{3}$/), transit: z.string().regex(/^\d{5}$/), account: z.string().regex(/^\d{5,12}$/).optional() }),
});
type StoredOriginator = Omit<z.infer<typeof originatorBody>, 'returns'> & { returns: { institution: string; transit: string; last4: string; sealed: SealedJson } };

export async function saveOriginator(input: z.infer<typeof originatorBody>) {
  const books = await db().fhBooks.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const prev = books.padOriginator as StoredOriginator | null;
  if (!input.returns.account && !prev) throw badRequest('Enter the account returned debits go back to.');
  const sealed = input.returns.account ? toJson(await seal(keys(), platformKekId(), input.returns.account, 'pad:returns')) : prev!.returns.sealed;
  const stored: StoredOriginator = { ...input, returns: { institution: input.returns.institution, transit: input.returns.transit, last4: input.returns.account?.slice(-4) ?? prev!.returns.last4, sealed } };
  await db().fhBooks.update({ where: { id: 1 }, data: { padOriginator: stored as unknown as Prisma.InputJsonValue } });
}

export async function originatorView() {
  const books = await db().fhBooks.findUnique({ where: { id: 1 } });
  const o = books?.padOriginator as StoredOriginator | null;
  if (!o) return null;
  return { originatorId: o.originatorId, dataCentre: o.dataCentre, shortName: o.shortName, longName: o.longName, transactionCode: o.transactionCode, returns: { institution: o.returns.institution, transit: o.returns.transit, account: `•••${o.returns.last4}` }, lastFileNumber: books!.lastFileNumber };
}

// ------------------------------------------------------------------ Debit batches
/** Invoices that can be debited on a date: sent, owing, due by then, noticed in time, with an active agreement, not already in a batch. */
export async function debitable(debitDate: string) {
  const date = day(debitDate);
  const agreements = await db().padAgreement.findMany({ where: { status: 'ACTIVE' } });
  if (!agreements.length) return [];
  const invoices = await db().invoice.findMany({ where: { status: 'SENT', tenantId: { in: agreements.map((a) => a.tenantId) }, dueDate: { lte: date } }, orderBy: { dueDate: 'asc' } });
  const inFlight = await db().padDebit.findMany({ where: { invoiceId: { in: invoices.map((i) => i.id) }, status: 'PENDING' }, select: { invoiceId: true, amountCents: true } });
  const out = [];
  for (const inv of invoices) {
    const a = agreements.find((x) => x.tenantId === inv.tenantId)!;
    const pending = inFlight.filter((d) => d.invoiceId === inv.id).reduce((s, d) => s + d.amountCents, 0);
    const owing = inv.totalCents - inv.paidCents - pending;
    if (owing <= 0) continue;
    const noticed = a.waivedPreNotice || (inv.issueDate && date.getTime() - inv.issueDate.getTime() >= NOTICE_DAYS * DAY);
    out.push({ invoiceId: inv.id, number: inv.number, tenantId: inv.tenantId, payor: a.payorName, agreementId: a.id, dueDate: inv.dueDate ? isoDay(inv.dueDate) : null, amountCents: owing, ready: !!noticed, reason: noticed ? null : 'NOTICE' });
  }
  return out;
}

export async function createBatch(debitDate: string, invoiceIds: string[] | null, adminId: string) {
  await assertOpenPeriod(debitDate);
  const books = await db().fhBooks.findUnique({ where: { id: 1 } });
  if (!books?.padOriginator) throw new HttpError(409, 'NO_ORIGINATOR', 'Enter FH’s originator details from the bank first.');
  const candidates = (await debitable(debitDate)).filter((c) => c.ready && (!invoiceIds || invoiceIds.includes(c.invoiceId)));
  if (!candidates.length) throw new HttpError(409, 'NOTHING_TO_DEBIT', 'No invoices are ready to debit on that date.');
  return db().$transaction(async (tx) => {
    const b = await tx.fhBooks.update({ where: { id: 1 }, data: { lastFileNumber: { increment: 1 } } });
    const fileNumber = ((b.lastFileNumber - 1) % 9999) + 1;
    return tx.padBatch.create({
      data: {
        fileNumber,
        debitDate: day(debitDate),
        totalCents: candidates.reduce((s, c) => s + c.amountCents, 0),
        count: candidates.length,
        createdById: adminId,
        debits: { create: candidates.map((c) => ({ agreementId: c.agreementId, invoiceId: c.invoiceId, tenantId: c.tenantId, amountCents: c.amountCents })) },
      },
      include: { debits: true },
    });
  });
}

/** The CPA-005 debit file for FH's bank. Opening each account number is audited by the caller. */
export async function batchFile(batchId: string) {
  const batch = await db().padBatch.findUnique({ where: { id: batchId }, include: { debits: { include: { agreement: true } } } });
  if (!batch) throw notFound('Batch');
  const books = await db().fhBooks.findUniqueOrThrow({ where: { id: 1 } });
  const o = books.padOriginator as StoredOriginator;
  const returnsAccount = await open(keys(), fromJson(o.returns.sealed), 'pad:returns');
  const invoices = await db().invoice.findMany({ where: { id: { in: batch.debits.map((d) => d.invoiceId) } }, select: { id: true, number: true } });
  const payments = [];
  for (const d of batch.debits.filter((x) => x.status !== 'RETURNED')) {
    const account = await open(keys(), fromJson(d.agreement.accountSealed as unknown as SealedJson), padAad(d.tenantId));
    payments.push({ amountCents: d.amountCents, payeeName: d.agreement.payorName, institution: d.agreement.institution, transit: d.agreement.transit, account, crossReference: invoices.find((i) => i.id === d.invoiceId)?.number ?? d.invoiceId.slice(0, 8) });
  }
  const content = buildCpa005(
    { originatorId: o.originatorId, fileCreationNumber: batch.fileNumber, destinationDataCentre: o.dataCentre, shortName: o.shortName, longName: o.longName, returns: { institution: o.returns.institution, transit: o.returns.transit, account: returnsAccount } },
    payments,
    isoDay(batch.debitDate),
    isoDay(new Date()),
    { kind: 'D', transactionCode: o.transactionCode },
  );
  return { name: `fh-pad-${String(batch.fileNumber).padStart(4, '0')}-${isoDay(batch.debitDate)}.txt`, content };
}

export async function markSent(batchId: string) {
  const b = await db().padBatch.findUnique({ where: { id: batchId } });
  if (!b) throw notFound('Batch');
  if (b.status !== 'CREATED') throw conflict('BATCH_STEP', 'This batch was already sent.');
  await db().padBatch.update({ where: { id: batchId }, data: { status: 'SENT', sentAt: new Date() } });
}

/** A batch not yet sent can be thrown away; its file number stays used (banks expect them to go up). */
export async function discardBatch(batchId: string) {
  const b = await db().padBatch.findUnique({ where: { id: batchId } });
  if (!b) throw notFound('Batch');
  if (b.status !== 'CREATED') throw conflict('BATCH_STEP', 'A batch sent to the bank can’t be discarded; record returns instead.');
  await db().padBatch.delete({ where: { id: batchId } });
}

/** The bank has taken the money: each debit becomes a payment on its invoice. */
export async function settleBatch(batchId: string, settledOn: string, adminId: string) {
  await assertOpenPeriod(settledOn);
  const b = await db().padBatch.findUnique({ where: { id: batchId }, include: { debits: true } });
  if (!b) throw notFound('Batch');
  if (b.status !== 'SENT') throw conflict('BATCH_STEP', b.status === 'CREATED' ? 'Mark the batch as sent to the bank first.' : 'This batch is already settled.');
  for (const d of b.debits.filter((x) => x.status === 'PENDING')) {
    await recordPayment(d.invoiceId, adminId, { amountCents: d.amountCents, receivedOn: settledOn, method: 'PAD', reference: `PAD file ${b.fileNumber}` });
    await db().padDebit.update({ where: { id: d.id }, data: { status: 'SETTLED' } });
  }
  await db().padBatch.update({ where: { id: batchId }, data: { status: 'SETTLED', settledAt: new Date() } });
}

/** The bank returned a debit (NSF, account closed, stopped). If it was settled, the payment is reversed and the balance is owing again. */
export async function returnDebit(debitId: string, reason: string, returnedOn: string, adminId: string) {
  await assertOpenPeriod(returnedOn);
  const d = await db().padDebit.findUnique({ where: { id: debitId }, include: { batch: true } });
  if (!d) throw notFound('Debit');
  if (d.status === 'RETURNED') throw conflict('ALREADY_RETURNED', 'This debit was already returned.');
  await db().$transaction(async (tx) => {
    if (d.status === 'SETTLED') {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
      await tx.invoicePayment.create({ data: { invoiceId: d.invoiceId, amountCents: -d.amountCents, receivedOn: day(returnedOn), method: 'PAD_RETURN', reference: `PAD file ${d.batch.fileNumber}: ${reason}`.slice(0, 120), recordedById: adminId } });
      await tx.invoice.update({ where: { id: d.invoiceId }, data: { paidCents: inv.paidCents - d.amountCents, status: 'SENT', paidAt: null } });
    }
    await tx.padDebit.update({ where: { id: debitId }, data: { status: 'RETURNED', returnReason: reason, returnedOn: day(returnedOn) } });
  });
  return d.tenantId;
}

export async function batches() {
  const rows = await db().padBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { debits: { include: { agreement: { select: { payorName: true } } } } } });
  const invoices = await db().invoice.findMany({ where: { id: { in: rows.flatMap((b) => b.debits.map((d) => d.invoiceId)) } }, select: { id: true, number: true } });
  return rows.map((b) => ({
    id: b.id,
    fileNumber: b.fileNumber,
    debitDate: isoDay(b.debitDate),
    status: b.status,
    totalCents: b.totalCents,
    count: b.count,
    sentAt: b.sentAt,
    settledAt: b.settledAt,
    debits: b.debits.map((d) => ({ id: d.id, invoiceId: d.invoiceId, number: invoices.find((i) => i.id === d.invoiceId)?.number ?? null, tenantId: d.tenantId, payor: d.agreement.payorName, amountCents: d.amountCents, status: d.status, returnReason: d.returnReason, returnedOn: d.returnedOn ? isoDay(d.returnedOn) : null })),
  }));
}
