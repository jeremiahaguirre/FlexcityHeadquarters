/**
 * Pay runs: approved hours → gross pay (payCalc) → source deductions (tax.ts) →
 * pay statements → bank deposit file (cpa005.ts).
 *
 * A run covers one pay period for the whole city or one department. It's
 * prepared as a DRAFT, recalculated and checked at approval by a second person,
 * then PAID once the deposit file has gone to the bank.
 */
import { createHash } from 'node:crypto';
import type { Prisma, Province } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { addDays } from '../../lib/time.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';
import { notify } from '../notifications/notifier.js';
import { accountNumber } from './bank.js';
import { type BankLink, encryptForBank, uploadToBank } from './bankLink.js';
import { type Payment, buildCpa005 } from './cpa005.js';
import { runPayroll } from './payrollRun.js';
import { type Deductions, type YearToDate, calculateDeductions, calculateQuebecDeductions } from './tax.js';
import { loadTaxTables } from './taxTables.js';
import { type Issue, IssueSet, issue } from './issues.js';

export interface PayrollSettings {
  businessNumber?: string;
  /** Revenu Québec identification number (1234567890RS0001), for Quebec staff. */
  quebecNumber?: string;
  originatorId?: string;
  originatorShortName?: string;
  originatorLongName?: string;
  destinationDataCentre?: string;
  returnsInstitution?: string;
  returnsTransit?: string;
  /** Sealed returns account: base64 parts. */
  returnsAccount?: { c: string; iv: string; t: string; k: string; kek: string; last4: string };
  employerAddress?: string;
  /** A second person approves every run (default on). */
  twoPersonApproval?: boolean;
  /** Approving and downloading deposit files needs a passkey sign-in (default on). */
  requirePasskey?: boolean;
  /** Host-to-host connection to the city's bank. */
  bank?: BankLink;
}

export const readSettings = (raw: unknown): PayrollSettings => (raw && typeof raw === 'object' ? (raw as PayrollSettings) : {});

export async function sealReturnsAccount(tenantId: string, account: string) {
  const s = await seal(keys(), tenantKekId(tenantId), account, `payroll-returns:${tenantId}`);
  return { c: s.ciphertext.toString('base64'), iv: s.iv.toString('base64'), t: s.authTag.toString('base64'), k: s.wrappedDataKey.toString('base64'), kek: s.kekId, last4: account.slice(-4) };
}

async function returnsAccount(tenantId: string, r: NonNullable<PayrollSettings['returnsAccount']>) {
  return open(keys(), { ciphertext: Buffer.from(r.c, 'base64'), iv: Buffer.from(r.iv, 'base64'), authTag: Buffer.from(r.t, 'base64'), wrappedDataKey: Buffer.from(r.k, 'base64'), kekId: r.kek }, `payroll-returns:${tenantId}`);
}

export const periodsPerYear = (weeks: number) => (weeks === 1 ? 52 : weeks === 2 ? 26 : weeks === 4 ? 13 : Math.round(52 / weeks));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ZERO_D: Deductions = { cpp: 0, cpp2: 0, ei: 0, federalTax: 0, provincialTax: 0, extraTax: 0, total: 0, employerCpp: 0, employerEi: 0, pensionable: 0, insurable: 0 };

interface YtdTotals extends YearToDate {
  federalTax: number;
  provincialTax: number;
  net: number;
}

/** Year-to-date from approved and paid statements in the same calendar year (by pay date). */
export async function yearToDate(tx: Tx, userId: string, year: number, excludeRunId?: string): Promise<YtdTotals> {
  const rows = await tx.payStatement.findMany({ where: { userId, year, payRun: { status: { in: ['APPROVED', 'PAID'] } }, ...(excludeRunId ? { payRunId: { not: excludeRunId } } : {}) } });
  const t: YtdTotals & { qpip: number; qpipInsurable: number } = { gross: 0, pensionable: 0, cpp: 0, cpp2: 0, insurable: 0, ei: 0, federalTax: 0, provincialTax: 0, net: 0, qpip: 0, qpipInsurable: 0 };
  for (const s of rows) {
    const d = s.deductions as unknown as Deductions;
    t.gross += Number(s.gross);
    t.net += Number(s.net);
    t.pensionable += d.pensionable ?? 0;
    t.insurable += d.insurable ?? 0;
    t.cpp += d.cpp;
    t.cpp2 += d.cpp2;
    t.ei += d.ei;
    t.federalTax += d.federalTax + (d.extraTax ?? 0);
    t.provincialTax += d.provincialTax;
    t.qpip += d.qpip ?? 0;
    t.qpipInsurable += d.qpipInsurable ?? 0;
  }
  for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] = r2(t[k]);
  return t;
}

export interface RunInput {
  departmentId: string | null;
  periodStart: string;
  weeks: number;
  payDate: string;
}

/** Works out every statement for a run. Replaces a draft's statements when `runId` is given. */
export async function buildRun(tx: Tx, tenantId: string, preparedById: string, input: RunInput, runId?: string) {
  const periodEnd = addDays(input.periodStart, input.weeks * 7 - 1);
  if (input.payDate < input.periodStart) throw badRequest('The pay date can’t be before the period starts.');
  let positions: string[] | null = null;
  if (input.departmentId) {
    const d = await tx.department.findUnique({ where: { id: input.departmentId }, include: { positions: { select: { id: true } } } });
    if (!d) throw notFound('Department');
    positions = d.positions.map((p) => p.id);
    if (!positions.length) throw badRequest('This department has no positions yet.');
  }
  // One live run per department (or city-wide) per period.
  const clash = await tx.payRun.findFirst({
    where: { departmentId: input.departmentId, periodStart: new Date(input.periodStart), status: { not: 'VOID' }, ...(runId ? { id: { not: runId } } : {}) },
  });
  if (clash) throw conflict('RUN_EXISTS', 'There is already a pay run for this department and period. Open it, or void it first.');

  const { results, warnings: calcWarnings } = await runPayroll(tx, tenantId, input.periodStart, input.weeks, null, positions);
  const year = Number(input.payDate.slice(0, 4));
  const P = periodsPerYear(input.weeks);
  const tables = await loadTaxTables(tx, year);
  const blockers = new IssueSet();
  const warnings = new IssueSet(calcWarnings);
  if (!tables.federal) blockers.add(issue('NO_FEDERAL_TABLE', { year }));
  else if (!tables.federal.verified) blockers.add(issue('FEDERAL_UNVERIFIED', { year }));

  const runUsers = [...new Set(results.map((r) => r.userId))];
  const enrollments = await tx.benefitEnrollment.findMany({
    where: { userId: { in: runUsers }, startsOn: { lte: new Date(periodEnd) }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(input.periodStart) } }], plan: { active: true } },
    include: { plan: true },
  });
  const [facilities, people, profiles, banks, departments] = await Promise.all([
    tx.facility.findMany({ select: { id: true, province: true } }),
    tx.user.findMany({ where: { id: { in: [...new Set(results.map((r) => r.userId))] } }, select: { id: true, firstName: true, lastName: true } }),
    tx.payProfile.findMany({ where: { userId: { in: [...new Set(results.map((r) => r.userId))] } } }),
    tx.bankAccount.findMany({ where: { userId: { in: [...new Set(results.map((r) => r.userId))] }, status: 'ACTIVE' } }),
    tx.position.findMany({ select: { id: true, departmentId: true } }),
  ]);
  const name = (id: string) => {
    const u = people.find((p) => p.id === id);
    return u ? `${u.firstName} ${u.lastName}` : id;
  };

  const byUser = new Map<string, typeof results>();
  for (const r of results) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

  const statements: Prisma.PayStatementCreateManyInput[] = [];
  const totals = { gross: 0, deductions: 0, net: 0, employerCpp: 0, employerEi: 0, people: 0, deposits: 0, cheques: 0, cpp: 0, cpp2: 0, ei: 0, tax: 0, benefits: 0, employerBenefits: 0, qpip: 0, employerQpip: 0, quebecTax: 0 };
  for (const [userId, rs] of byUser) {
    const lines = rs.flatMap((r) => r.result.lines.map((l) => ({ code: l.code, positionId: l.positionId, hours: Number(l.hours), rate: Number(l.rate), amount: Number(l.amount) })));
    const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
    if (gross <= 0) continue;
    const hours = r2(lines.filter((l) => l.code !== 'VACATION_PAY' && l.code !== 'STAT_HOLIDAY_PAY').reduce((s, l) => s + l.hours, 0));
    const main = [...rs].sort((a, b) => Number(b.result.grossWages) - Number(a.result.grossWages))[0]!;
    const profile = profiles.find((p) => p.userId === userId);
    const province = (profile?.province ?? facilities.find((f) => f.id === main.facilityId)?.province ?? 'ON') as Province;
    const quebec = province === 'QC';
    const prov = quebec ? null : tables.provincial.get(province);
    if (quebec) {
      if (!tables.quebec) blockers.add(issue('QUEBEC_TABLES', { year }));
      else if (!tables.quebec.verified) blockers.add(issue('QUEBEC_UNVERIFIED', { year }));
    } else if (!prov) blockers.add(issue('NO_PROVINCE_TABLE', { province, year }));
    else if (!prov.verified) blockers.add(issue('PROVINCE_UNVERIFIED', { province, year }));
    const ytd = await yearToDate(tx, userId, year, runId);
    // Benefits and deductions: each plan's employee and employer share for this pay.
    const benefits = enrollments
      .filter((e) => e.userId === userId)
      .map((e) => {
        const pl = e.plan;
        const employee = e.employeeAmount != null ? Number(e.employeeAmount) : r2((gross * Number(pl.employeePercent)) / 100 + Number(pl.employeeAmount));
        const employer = r2((gross * Number(pl.employerPercent)) / 100 + Number(pl.employerAmount));
        return { planId: pl.id, name: pl.name, nameFr: pl.nameFr, kind: pl.kind, employee, employer, taxable: pl.employerTaxable ? employer : 0 };
      });
    const sumOf = (pick: (b: (typeof benefits)[number]) => number) => r2(benefits.reduce((s, b) => s + pick(b), 0));
    const rpp = sumOf((b) => (b.kind === 'PENSION' ? b.employee : 0));
    const unionDues = sumOf((b) => (b.kind === 'UNION_DUES' ? b.employee : 0));
    const afterTax = sumOf((b) => (b.kind !== 'PENSION' && b.kind !== 'UNION_DUES' ? b.employee : 0));
    const taxableBenefit = sumOf((b) => b.taxable);
    const employerBenefits = sumOf((b) => b.employer);
    const common = {
      gross,
      periodsPerYear: P,
      ytd,
      federalClaim: profile?.federalClaim != null ? Number(profile.federalClaim) : null,
      provincialClaim: profile?.provincialClaim != null ? Number(profile.provincialClaim) : null,
      extraTax: profile ? Number(profile.extraTaxPerPeriod) : 0,
      cppExempt: profile?.cppExempt ?? false,
      eiExempt: profile?.eiExempt ?? false,
      rpp,
      unionDues,
      taxableBenefit,
    };
    const d: Deductions = !tables.federal
      ? ZERO_D
      : quebec
        ? tables.quebec
          ? calculateQuebecDeductions({ ...common, federal: tables.federal.data, quebec: tables.quebec.data })
          : ZERO_D
        : prov
          ? { ...calculateDeductions({ ...common, federal: tables.federal.data, provincial: prov.data }), plan: 'CPP' }
          : ZERO_D;
    const benefitDeductions = r2(rpp + unionDues + afterTax);
    const totalDeductions = r2(d.total + benefitDeductions);
    const net = r2(gross - totalDeductions);
    if (net < 0) blockers.add(issue('NEGATIVE_NET', { name: name(userId) }));
    const bank = banks.find((b) => b.userId === userId);
    if (!bank) warnings.add(issue('NO_BANK', { name: name(userId) }));
    if (!profile?.sinLast3) warnings.add(issue('NO_SIN', { name: name(userId) }));
    const lineDept = (positionId: string | null) => departments.find((p) => p.id === positionId)?.departmentId ?? null;
    statements.push({
      tenantId,
      payRunId: runId ?? '',
      userId,
      departmentId: input.departmentId ?? lineDept([...lines].sort((a, b) => b.amount - a.amount)[0]?.positionId ?? null),
      province,
      year,
      payDate: new Date(input.payDate),
      hours,
      earnings: lines,
      deductions: { ...d, benefits, rpp, unionDues, afterTax, taxableBenefit, employerBenefits } as unknown as Prisma.InputJsonValue,
      gross,
      totalDeductions,
      net,
      employerCpp: d.employerCpp,
      employerEi: d.employerEi,
      ytd: {
        gross: r2(ytd.gross + gross),
        cpp: r2(ytd.cpp + d.cpp),
        cpp2: r2(ytd.cpp2 + d.cpp2),
        ei: r2(ytd.ei + d.ei),
        federalTax: r2(ytd.federalTax + d.federalTax + d.extraTax),
        provincialTax: r2(ytd.provincialTax + d.provincialTax),
        net: r2(ytd.net + net),
        pensionable: r2(ytd.pensionable + d.pensionable),
        insurable: r2(ytd.insurable + d.insurable),
        ...(d.plan === 'QPP' ? { qpip: r2((ytd.qpip ?? 0) + (d.qpip ?? 0)), qpipInsurable: r2((ytd.qpipInsurable ?? 0) + (d.qpipInsurable ?? 0)) } : {}),
      },
      bankAccountId: bank?.id ?? null,
      depositLast4: bank?.last4 ?? null,
    });
    totals.gross += gross;
    totals.deductions += totalDeductions;
    totals.benefits += benefitDeductions;
    totals.employerBenefits += employerBenefits;
    totals.net += net;
    totals.employerCpp += d.employerCpp;
    totals.employerEi += d.employerEi;
    totals.cpp += d.cpp + d.cpp2;
    totals.ei += d.ei;
    totals.tax += d.federalTax + d.provincialTax + d.extraTax;
    totals.qpip += d.qpip ?? 0;
    totals.employerQpip += d.employerQpip ?? 0;
    if (d.plan === 'QPP') totals.quebecTax += d.provincialTax;
    totals.people += 1;
    if (bank) totals.deposits += 1;
    else totals.cheques += 1;
  }
  for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = r2(totals[k]);
  if (!statements.length) warnings.add(issue('NO_HOURS'));

  const data = {
    departmentId: input.departmentId,
    periodStart: new Date(input.periodStart),
    periodEnd: new Date(periodEnd),
    payDate: new Date(input.payDate),
    periodsPerYear: P,
    totals,
    blockers: blockers.list() as unknown as Prisma.InputJsonValue,
    warnings: warnings.list() as unknown as Prisma.InputJsonValue,
  };
  const run = runId ? await tx.payRun.update({ where: { id: runId }, data }) : await tx.payRun.create({ data: { ...data, tenantId, preparedById } });
  await tx.payStatement.deleteMany({ where: { payRunId: run.id } });
  if (statements.length) await tx.payStatement.createMany({ data: statements.map((s) => ({ ...s, payRunId: run.id })) });
  return run;
}

export function runInput(run: { departmentId: string | null; periodStart: Date; periodEnd: Date; payDate: Date }): RunInput {
  const start = run.periodStart.toISOString().slice(0, 10);
  const days = Math.round((run.periodEnd.getTime() - run.periodStart.getTime()) / 86_400_000) + 1;
  return { departmentId: run.departmentId, periodStart: start, weeks: Math.round(days / 7), payDate: run.payDate.toISOString().slice(0, 10) };
}

/** A second person checks and releases the run. It's recalculated first so year-to-date figures are current. */
export async function approveRun(tx: Tx, tenantId: string, runId: string, approverId: string, settings: PayrollSettings) {
  const run = await tx.payRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Pay run');
  if (run.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'Only a draft pay run can be approved.');
  if (settings.twoPersonApproval !== false && run.preparedById === approverId) throw forbidden('Someone other than the person who prepared this pay run has to approve it.');
  const fresh = await buildRun(tx, tenantId, run.preparedById, runInput(run), run.id);
  const blockers = fresh.blockers as unknown as Array<Issue | string>;
  if (blockers.length) throw new HttpError(409, 'RUN_BLOCKED', 'This pay run can’t be approved yet.', { blockers });
  const approved = await tx.payRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() } });
  const people = await tx.payStatement.findMany({ where: { payRunId: runId }, select: { id: true, userId: true, net: true } });
  await notify(
    tx,
    tenantId,
    people.map((s) => ({ userId: s.userId, type: 'pay_statement_ready', params: { payDate: run.payDate.toISOString().slice(0, 10) }, link: `/pay?statement=${s.id}`, email: 'pay_statement_ready' })),
  );
  return approved;
}

/** The bank file for an approved run. The same run always gets the same file creation number. */
export async function depositFile(tx: Tx, tenantId: string, runId: string, settings: PayrollSettings) {
  const run = await tx.payRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Pay run');
  if (run.status !== 'APPROVED' && run.status !== 'PAID') throw conflict('NOT_APPROVED', 'Approve the pay run before creating its deposit file.');
  const missing = (['originatorId', 'originatorShortName', 'originatorLongName', 'destinationDataCentre', 'returnsInstitution', 'returnsTransit', 'returnsAccount'] as const).filter((k) => !settings[k]);
  if (missing.length) throw new HttpError(409, 'DEPOSIT_SETUP', 'Finish direct deposit set-up (the details from your bank) in payroll settings first.', { missing });
  let fcn = run.fileCreationNumber;
  if (!fcn) {
    const last = await tx.payRun.aggregate({ _max: { fileCreationNumber: true } });
    fcn = ((last._max.fileCreationNumber ?? 0) % 9999) + 1;
  }
  const statements = await tx.payStatement.findMany({ where: { payRunId: runId, bankAccountId: { not: null } }, orderBy: { id: 'asc' } });
  const accounts = await tx.bankAccount.findMany({ where: { id: { in: statements.map((s) => s.bankAccountId!) } } });
  const users = await tx.user.findMany({ where: { id: { in: statements.map((s) => s.userId) } }, select: { id: true, firstName: true, lastName: true } });
  const payments: Payment[] = [];
  for (const s of statements) {
    const acc = accounts.find((a) => a.id === s.bankAccountId)!;
    const u = users.find((x) => x.id === s.userId);
    if (Number(s.net) <= 0) continue;
    payments.push({
      amountCents: Math.round(Number(s.net) * 100),
      payeeName: acc.holderName || (u ? `${u.firstName} ${u.lastName}` : ''),
      institution: acc.institution,
      transit: acc.transit,
      account: await accountNumber(tenantId, acc),
      crossReference: s.id.replace(/-/g, '').slice(0, 19),
    });
  }
  if (!payments.length) throw conflict('NO_DEPOSITS', 'Nobody in this pay run has a verified direct deposit account.');
  const file = buildCpa005(
    {
      originatorId: settings.originatorId!,
      fileCreationNumber: fcn,
      destinationDataCentre: settings.destinationDataCentre!,
      shortName: settings.originatorShortName!,
      longName: settings.originatorLongName!,
      returns: { institution: settings.returnsInstitution!, transit: settings.returnsTransit!, account: await returnsAccount(tenantId, settings.returnsAccount!) },
    },
    payments,
    run.payDate.toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10),
  );
  const sha256 = createHash('sha256').update(file).digest('hex');
  await tx.payRun.update({ where: { id: runId }, data: { fileCreationNumber: fcn, depositFileSha256: sha256 } });
  return { file, sha256, fileCreationNumber: fcn, count: payments.length, totalCents: payments.reduce((s, p) => s + p.amountCents, 0) };
}

/** Business days (Mon–Fri) from today until the pay date. Banks want payroll files a day or two ahead. */
export function businessDaysUntil(payDate: string, today = new Date().toISOString().slice(0, 10)): number {
  let n = 0;
  for (let d = new Date(`${today}T12:00:00Z`); d.toISOString().slice(0, 10) < payDate; d = new Date(d.getTime() + 86_400_000)) {
    const dow = new Date(d.getTime() + 86_400_000).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

/** Builds (and if the bank asks, encrypts) the file to send. Inside a transaction; sends nothing. */
export async function prepareBankFile(tx: Tx, tenantId: string, runId: string, settings: PayrollSettings) {
  if (!settings.bank) throw conflict('BANK_NOT_CONNECTED', 'Connect your bank in payroll settings first, or download the deposit file.');
  if (await tx.payTransmission.findFirst({ where: { payRunId: runId, status: 'SENT' } })) throw conflict('ALREADY_SENT', 'This pay run’s deposit file was already sent to the bank. Sending it again could pay people twice.');
  const f = await depositFile(tx, tenantId, runId, settings);
  const run = await tx.payRun.findUniqueOrThrow({ where: { id: runId }, select: { payDate: true } });
  const encrypted = !!settings.bank.pgpPublicKey;
  const base = `FH-PAY-${String(f.fileCreationNumber).padStart(4, '0')}-${run.payDate.toISOString().slice(0, 10).replace(/-/g, '')}.txt`;
  const content = encrypted ? await encryptForBank(f.file, settings.bank.pgpPublicKey!) : Buffer.from(f.file, 'latin1');
  return { ...f, fileName: encrypted ? `${base}.pgp` : base, content, encrypted, payDate: run.payDate.toISOString().slice(0, 10) };
}

/** Sends a prepared file and records the attempt, sent or failed. */
export async function sendToBank(
  tenantId: string,
  runId: string,
  sentById: string | null,
  settings: PayrollSettings,
  prepared: Awaited<ReturnType<typeof prepareBankFile>>,
  record: (data: { tenantId: string; payRunId: string; sentById: string | null; method: string; fileName: string; sha256: string; encrypted: boolean; status: 'SENT' | 'FAILED'; error: string | null }) => Promise<unknown>,
) {
  try {
    await uploadToBank(tenantId, settings.bank!, prepared.fileName, prepared.content);
    await record({ tenantId, payRunId: runId, sentById, method: 'SFTP', fileName: prepared.fileName, sha256: prepared.sha256, encrypted: prepared.encrypted, status: 'SENT', error: null });
    return { status: 'SENT' as const, fileName: prepared.fileName, deposits: prepared.count, totalCents: prepared.totalCents, late: businessDaysUntil(prepared.payDate) < 2 };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await record({ tenantId, payRunId: runId, sentById, method: 'SFTP', fileName: prepared.fileName, sha256: prepared.sha256, encrypted: prepared.encrypted, status: 'FAILED', error: message.slice(0, 500) });
    return { status: 'FAILED' as const, fileName: prepared.fileName, error: message };
  }
}
