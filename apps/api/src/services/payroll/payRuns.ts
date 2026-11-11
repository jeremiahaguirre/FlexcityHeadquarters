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
import { claimsToPay } from './expenses.js';
import { banks as lieuBanksOf, bankOvertime, expiredHours, lieuPolicy, regularRate, type StatementLieu } from './lieu.js';
import { withBonusMethod } from './lumpSum.js';
import { type Issue, IssueSet, issue } from './issues.js';
import { NOT_HOURS } from './statementHours.js';


export interface PayrollSettings {
  businessNumber?: string;
  /** Export to a payroll provider: the layout and ADP's company code and batch ID. */
  providerExport?: { format: 'generic' | 'adp' | 'dayforce' | 'wagepoint'; adpCompanyCode?: string | null; adpBatchId?: string | null };
  /** For the Health Services Fund rate: municipalities and other public bodies are 'public' (the default). */
  quebecSector?: 'public' | 'private';
  /** Revenu Québec identification number (1234567890RS0001), for Quebec staff. */
  quebecNumber?: string;
  /** RL-1 XML: Revenu Québec's preparer number (NP123456), the software authorization number, and the first number of the slip range it assigned. */
  rqPreparerNumber?: string;
  rqCertificationNumber?: string;
  rl1FirstSlip?: number;
  /** RL-1 slip sequence numbers given out, by year and person, so amendments reuse them. */
  rl1Numbers?: Record<string, Record<string, number>>;
  originatorId?: string;
  originatorShortName?: string;
  originatorLongName?: string;
  destinationDataCentre?: string;
  returnsInstitution?: string;
  returnsTransit?: string;
  /** Sealed returns account: base64 parts. */
  returnsAccount?: { c: string; iv: string; t: string; k: string; kek: string; last4: string };
  employerAddress?: string;
  /** Structured employer address for electronic filing (T4 XML, ROE). */
  employerMailing?: import('./bank.js').MailingAddress;
  /** Who CRA and Service Canada contact about a filing. */
  filingContact?: { name: string; phone: string; email?: string | null };
  /** CRA transmitter number (MM123456), when a service files for the city; otherwise the business number is used. */
  transmitterNumber?: string;
  /** A second person approves every run (default on). */
  twoPersonApproval?: boolean;
  /** Approving and downloading deposit files needs a passkey sign-in (default on). */
  requirePasskey?: boolean;
  /** In the app, or with ADP, Dayforce or Wagepoint over their API (providers.ts). */
  payrollProvider?: import('./providers.js').ProviderSettings;
  /** Host-to-host connection to the city's bank. */
  bank?: BankLink;
  /** Time in lieu (lieu.ts): whether people may bank overtime, the most they may hold, how long they may keep it. */
  lieu?: { enabled?: boolean; capHours?: number; takeWithinMonths?: number };
  /** Mileage rates in cents per km, the yearly threshold for the lower rate, and above what amount a receipt is needed (expenses.ts). */
  mileage?: { centsPerKm?: number; centsAfter?: number; tierKm?: number; receiptOver?: number };
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
  /** REGULAR: the period's hours and salaries. OFF_CYCLE: only the one-time payments added to it. */
  kind?: 'REGULAR' | 'OFF_CYCLE';
  note?: string | null;
}

/** One-time items: which are taxed as a lump sum (bonus method), which as regular pay, which not at all, which come off after tax. */
export const LUMP_SUM_KINDS = new Set(['BONUS', 'RETRO', 'VACATION_PAYOUT', 'LIEU_PAYOUT']);
export const REGULAR_EARNING_KINDS = new Set(['ALLOWANCE', 'OTHER_EARNING']);
export const REIMBURSEMENT_KINDS = new Set(['REIMBURSEMENT']);
export const DEDUCTION_KINDS = new Set(['RECOVERY', 'OTHER_DEDUCTION']);
export const ADJUSTMENT_KINDS = [...LUMP_SUM_KINDS, ...REGULAR_EARNING_KINDS, ...REIMBURSEMENT_KINDS, ...DEDUCTION_KINDS] as const;

const overlapDays = (aFrom: string, aTo: string, bFrom: string, bTo: string | null) => {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = bTo && bTo < aTo ? bTo : aTo;
  return from > to ? 0 : Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
};

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
  const kind = input.kind ?? 'REGULAR';
  // One live regular run per department (or city-wide) per period; off-cycle runs can be added any time.
  if (kind === 'REGULAR') {
    // Any overlapping period counts, and a city-wide run overlaps every department's (and the reverse): nobody is paid twice for the same days.
    const clash = await tx.payRun.findFirst({
      where: {
        kind: 'REGULAR',
        status: { not: 'VOID' },
        periodStart: { lte: new Date(periodEnd) },
        periodEnd: { gte: new Date(input.periodStart) },
        ...(input.departmentId ? { OR: [{ departmentId: input.departmentId }, { departmentId: null }] } : {}),
        ...(runId ? { id: { not: runId } } : {}),
      },
    });
    if (clash) throw conflict('RUN_EXISTS', 'There is already a pay run covering some of these days for these people. Open it, or void it first.');
  }

  const { results, warnings: calcWarnings } = kind === 'OFF_CYCLE' ? { results: [] as Awaited<ReturnType<typeof runPayroll>>['results'], warnings: [] } : await runPayroll(tx, tenantId, input.periodStart, input.weeks, null, positions);
  // Salaried staff: an even share of the annual salary each period (prorated when it starts or ends inside it).
  const salaries =
    kind === 'OFF_CYCLE'
      ? []
      : await tx.salary.findMany({ where: { effectiveFrom: { lte: new Date(periodEnd) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(input.periodStart) } }], ...(positions ? { positionId: { in: positions } } : {}) }, orderBy: { effectiveFrom: 'asc' } });
  const adjustments = runId ? await tx.payAdjustment.findMany({ where: { payRunId: runId } }) : [];
  // Time in lieu: approved days off from the bank that start in this period are paid here.
  const policy = lieuPolicy(readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings));
  let lieuOff =
    kind === 'OFF_CYCLE'
      ? []
      : await tx.timeOffRequest.findMany({ where: { type: 'LIEU', status: 'APPROVED', startsAt: { gte: new Date(`${input.periodStart}T00:00:00Z`), lt: new Date(`${addDays(periodEnd, 1)}T00:00:00Z`) } }, select: { userId: true, chargedHours: true } });
  if (positions && lieuOff.length) {
    const inDept = new Set((await tx.userPosition.findMany({ where: { userId: { in: lieuOff.map((r) => r.userId) }, positionId: { in: positions } }, select: { userId: true } })).map((u) => u.userId));
    lieuOff = lieuOff.filter((r) => inDept.has(r.userId));
  }
  const orders = await tx.payDeductionOrder.findMany({ where: { startsOn: { lte: new Date(input.payDate) }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(input.payDate) } }] } });
  const year = Number(input.payDate.slice(0, 4));
  const P = periodsPerYear(input.weeks);
  const tables = await loadTaxTables(tx, year);
  const blockers = new IssueSet();
  const warnings = new IssueSet(calcWarnings);
  if (!tables.federal) blockers.add(issue('NO_FEDERAL_TABLE', { year }));
  else if (!tables.federal.verified) blockers.add(issue('FEDERAL_UNVERIFIED', { year }));

  const runUsers = [...new Set([...results.map((r) => r.userId), ...salaries.map((x) => x.userId), ...adjustments.map((x) => x.userId), ...lieuOff.map((r) => r.userId)])];
  // Approved expense claims: everyone's on a city-wide run; on a department run, its people's.
  const claims = kind === 'OFF_CYCLE' ? [] : await claimsToPay(tx, runId, input.payDate, input.departmentId ? runUsers : null);
  for (const c of claims) if (!runUsers.includes(c.userId)) runUsers.push(c.userId);
  const lieuBanks = await lieuBanksOf(tx, runUsers, { excludeRunId: runId });
  const bankers = new Set(policy.enabled && kind === 'REGULAR' ? (await tx.user.findMany({ where: { id: { in: runUsers }, bankOvertime: true }, select: { id: true } })).map((u) => u.id) : []);
  const leaving = new Set((await tx.offboarding.findMany({ where: { userId: { in: runUsers }, lastDay: { lte: new Date(periodEnd) } }, select: { userId: true } })).map((o) => o.userId));
  // Someone who also worked in another department this period has to be paid in one run (city-wide), so
  // tax and CPP/EI are worked out once on all their pay, not twice on halves.
  if (kind === 'REGULAR' && input.departmentId && positions && runUsers.length) {
    const elsewhere = await tx.timePunch.findMany({
      where: { userId: { in: runUsers }, status: 'APPROVED', positionId: { notIn: positions }, clockIn: { lt: new Date(`${addDays(periodEnd, 1)}T12:00:00Z`) }, clockOut: { gt: new Date(`${input.periodStart}T00:00:00Z`) } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const who = await tx.user.findMany({ where: { id: { in: elsewhere.map((e) => e.userId) } }, select: { firstName: true, lastName: true } });
    for (const u of who) blockers.add(issue('OTHER_DEPARTMENT_HOURS', { name: `${u.firstName} ${u.lastName}` }));
  }
  const enrollments = kind === 'OFF_CYCLE' ? [] : await tx.benefitEnrollment.findMany({
    where: { userId: { in: runUsers }, startsOn: { lte: new Date(periodEnd) }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(input.periodStart) } }], plan: { active: true } },
    include: { plan: true },
  });
  const [facilities, people, profiles, banks, departments] = await Promise.all([
    tx.facility.findMany({ select: { id: true, province: true } }),
    tx.user.findMany({ where: { id: { in: runUsers } }, select: { id: true, firstName: true, lastName: true } }),
    tx.payProfile.findMany({ where: { userId: { in: runUsers } } }),
    tx.bankAccount.findMany({ where: { userId: { in: runUsers }, status: 'ACTIVE' } }),
    tx.position.findMany({ select: { id: true, departmentId: true } }),
  ]);
  const name = (id: string) => {
    const u = people.find((p) => p.id === id);
    return u ? `${u.firstName} ${u.lastName}` : id;
  };

  const byUser = new Map<string, typeof results>();
  for (const u of runUsers) byUser.set(u, []);
  for (const r of results) byUser.get(r.userId)!.push(r);
  // What each court order has already collected (approved or paid runs), so it stops at the total owed.
  const collected = new Map<string, number>();
  if (orders.length) {
    const prior = await tx.payStatement.findMany({ where: { userId: { in: [...new Set(orders.map((o) => o.userId))] }, payRun: { status: { in: ['APPROVED', 'PAID'] } }, ...(runId ? { payRunId: { not: runId } } : {}) }, select: { deductions: true } });
    for (const st of prior) for (const o of ((st.deductions as { orders?: Array<{ id: string; amount: number }> }).orders ?? [])) collected.set(o.id, (collected.get(o.id) ?? 0) + o.amount);
  }
  // The person's usual pay, for the bonus method: their latest regular pay before this one (never this run's own figures).
  const lastRegular = async (userId: string) =>
    Number((await tx.payStatement.findFirst({ where: { userId, payDate: { lte: new Date(input.payDate) }, payRun: { kind: 'REGULAR', status: { not: 'VOID' } }, ...(runId ? { payRunId: { not: runId } } : {}) }, orderBy: { payDate: 'desc' }, select: { gross: true } }))?.gross ?? 0);
  const periodDays = input.weeks * 7;

  const statements: Prisma.PayStatementCreateManyInput[] = [];
  const totals = { gross: 0, deductions: 0, net: 0, employerCpp: 0, employerEi: 0, people: 0, deposits: 0, cheques: 0, cpp: 0, cpp2: 0, ei: 0, tax: 0, benefits: 0, employerBenefits: 0, qpip: 0, employerQpip: 0, quebecTax: 0, reimbursements: 0, oneTimeDeductions: 0, orders: 0 };
  for (const [userId, rs] of byUser) {
    let lines = rs.flatMap((r) => r.result.lines.map((l) => ({ code: l.code as string, positionId: l.positionId as string | null, hours: Number(l.hours), rate: Number(l.rate), amount: Number(l.amount), description: undefined as string | undefined })));
    let hours = r2(lines.filter((l) => !NOT_HOURS.has(l.code)).reduce((s, l) => s + l.hours, 0));
    // Salaried: the salary replaces hours pay (overtime stays for those eligible for it).
    const mySalaries = salaries.filter((x) => x.userId === userId);
    if (mySalaries.length) {
      // The salary covers its own position's hours (overtime still paid when eligible); hours in other positions stay hourly.
      const salaried = new Set(mySalaries.map((x) => x.positionId));
      const keepOt = mySalaries.some((x) => x.overtimeEligible);
      lines = lines.filter((l) => !salaried.has(l.positionId ?? '') || (keepOt && l.code.startsWith('OVERTIME')));
      hours = r2(lines.filter((l) => !salaried.has(l.positionId ?? '') && !NOT_HOURS.has(l.code)).reduce((a, l) => a + l.hours, 0));
      for (const sal of mySalaries) {
        const days = overlapDays(input.periodStart, periodEnd, sal.effectiveFrom.toISOString().slice(0, 10), sal.effectiveTo?.toISOString().slice(0, 10) ?? null);
        if (!days) continue;
        const share = days / periodDays;
        const amount = r2((Number(sal.annualAmount) / P) * share);
        const h = r2(Number(sal.weeklyHours) * input.weeks * share);
        hours += h;
        lines.push({ code: 'SALARY', positionId: sal.positionId, hours: h, rate: r2(Number(sal.annualAmount)), amount, description: undefined });
      }
      hours = r2(hours + lines.filter((l) => salaried.has(l.positionId ?? '') && l.code.startsWith('OVERTIME')).reduce((a, l) => a + l.hours, 0));
    }
    // One-time items on this run.
    const mine = adjustments.filter((x) => x.userId === userId);
    // Time in lieu: overtime into the bank (up to the cap), days off from it paid, payouts counted.
    const lieuBank = lieuBanks.get(userId)!;
    const lieu: StatementLieu = { banked: 0, otHours: 0, taken: 0, paidOut: 0 };
    if (bankers.has(userId)) {
      const b = bankOvertime(lines, policy.capHours - lieuBank.balance);
      lines = b.lines;
      lieu.banked = b.banked;
      lieu.otHours = b.otHours;
      hours = r2(hours - b.otHours);
    }
    const takenHours = r2(lieuOff.filter((r) => r.userId === userId).reduce((a, r) => a + Number(r.chargedHours ?? 0), 0));
    if (takenHours > 0) {
      lieu.taken = takenHours;
      // A salary already continues through days off; hourly staff are paid the hours at their regular rate.
      if (!mySalaries.length) {
        const mainPos = [...lines].sort((a, b) => b.hours - a.hours)[0]?.positionId ?? null;
        const rate = await regularRate(tx, userId, periodEnd, mainPos);
        if (rate == null) blockers.add(issue('LIEU_NO_RATE', { name: name(userId) }));
        else {
          lines.push({ code: 'LIEU_TAKEN', positionId: mainPos, hours: takenHours, rate, amount: r2(takenHours * rate), description: undefined });
          hours = r2(hours + takenHours);
        }
      }
    }
    lieu.paidOut = r2(mine.filter((x) => x.kind === 'LIEU_PAYOUT').reduce((a, x) => a + Number(x.hours ?? 0), 0));
    const used = r2(lieu.taken + lieu.paidOut);
    if (used > r2(lieuBank.balance + lieu.banked) + 0.001) blockers.add(issue('LIEU_SHORT', { name: name(userId), hours: r2(lieuBank.balance + lieu.banked) }));
    const stale = r2(expiredHours(lieuBank, policy, input.payDate) - used);
    if (policy.enabled && stale > 0) warnings.add(issue('LIEU_EXPIRED', { name: name(userId), hours: stale, months: policy.takeWithinMonths }));
    const after = r2(lieuBank.balance + lieu.banked - used);
    if (leaving.has(userId) && after > 0) warnings.add(issue('LIEU_OWED', { name: name(userId), hours: after }));
    const amt = (k: Set<string>) => r2(mine.filter((x) => k.has(x.kind)).reduce((a, x) => a + Number(x.amount), 0));
    for (const x of mine.filter((y) => LUMP_SUM_KINDS.has(y.kind) || REGULAR_EARNING_KINDS.has(y.kind))) lines.push({ code: x.kind, positionId: x.positionId, hours: 0, rate: 0, amount: r2(Number(x.amount)), description: x.description });
    // On an off-cycle run every earning is extra to the person's usual pay: all of it by the bonus method.
    const lump = kind === 'OFF_CYCLE' ? r2(lines.reduce((a, l) => a + l.amount, 0)) : amt(LUMP_SUM_KINDS);
    const myClaims = claims.filter((c) => c.userId === userId);
    const reimbursements = r2(amt(REIMBURSEMENT_KINDS) + myClaims.reduce((a, c) => a + c.amount, 0));
    const oneTimeDeductions = amt(DEDUCTION_KINDS);
    const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
    if (gross <= 0 && reimbursements <= 0) {
      if (oneTimeDeductions > 0) warnings.add(issue('DEDUCTION_WITHOUT_PAY', { name: name(userId) }));
      continue;
    }
    const main = [...rs].sort((a, b) => Number(b.result.grossWages) - Number(a.result.grossWages))[0];
    const mainFacility = main?.facilityId ?? null;
    const profile = profiles.find((p) => p.userId === userId);
    const province = (profile?.province ?? facilities.find((f) => f.id === mainFacility)?.province ?? facilities[0]?.province ?? 'ON') as Province;
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
    const federal = tables.federal?.data;
    const qc = tables.quebec?.data;
    const calc = (g: number): Deductions =>
      !federal ? ZERO_D : quebec ? (qc ? calculateQuebecDeductions({ ...common, gross: g, federal, quebec: qc }) : ZERO_D) : prov ? { ...calculateDeductions({ ...common, gross: g, federal, provincial: prov.data }), plan: 'CPP' } : ZERO_D;
    // Lump sums by CRA's bonus method; everything else as the period's pay.
    const d: Deductions = lump > 0 ? withBonusMethod(calc, r2(gross - lump), lump, P, await lastRegular(userId)) : calc(gross);
    const benefitDeductions = r2(rpp + unionDues + afterTax);
    let totalDeductions = r2(d.total + benefitDeductions + oneTimeDeductions);
    // Court and CRA orders, after everything else, never above their share of net pay or the total owed.
    const netBefore = r2(gross - totalDeductions);
    const orderLines: Array<{ id: string; kind: string; payee: string; amount: number }> = [];
    let taken = 0;
    for (const o of orders.filter((x) => x.userId === userId)) {
      const want = o.amountPerPay != null ? Number(o.amountPerPay) : (Number(o.percentOfNet ?? 0) / 100) * netBefore;
      const cap = (Number(o.maxPercentOfNet) / 100) * netBefore - taken;
      const left = o.totalOwed != null ? Number(o.totalOwed) - (collected.get(o.id) ?? 0) : Infinity;
      const amount = r2(Math.max(0, Math.min(want, cap, left)));
      if (!amount) continue;
      taken += amount;
      orderLines.push({ id: o.id, kind: o.kind, payee: o.payee, amount });
    }
    const ordersTotal = r2(taken);
    totalDeductions = r2(totalDeductions + ordersTotal);
    const net = r2(gross - totalDeductions + reimbursements);
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
      deductions: { ...d, benefits, rpp, unionDues, afterTax, taxableBenefit, employerBenefits, lumpSum: lump, reimbursements, oneTimeDeductions, oneTime: mine.filter((x) => REIMBURSEMENT_KINDS.has(x.kind) || DEDUCTION_KINDS.has(x.kind)).map((x) => ({ kind: x.kind, description: x.description, amount: Number(x.amount) })), orders: orderLines, ...(myClaims.length ? { expenses: myClaims.map((c) => ({ id: c.id, title: c.title, amount: c.amount })) } : {}), ...(lieu.banked || lieu.taken || lieu.paidOut ? { lieu } : {}) } as unknown as Prisma.InputJsonValue,
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
    totals.reimbursements += reimbursements;
    totals.oneTimeDeductions += oneTimeDeductions;
    totals.orders += ordersTotal;
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
    kind,
    note: input.note ?? null,
    totals,
    blockers: blockers.list() as unknown as Prisma.InputJsonValue,
    warnings: warnings.list() as unknown as Prisma.InputJsonValue,
  };
  const run = runId ? await tx.payRun.update({ where: { id: runId }, data }) : await tx.payRun.create({ data: { ...data, tenantId, preparedById } });
  await tx.payStatement.deleteMany({ where: { payRunId: run.id } });
  if (statements.length) await tx.payStatement.createMany({ data: statements.map((s) => ({ ...s, payRunId: run.id })) });
  return run;
}

export function runInput(run: { departmentId: string | null; periodStart: Date; periodEnd: Date; payDate: Date; kind?: string; note?: string | null }): RunInput {
  const start = run.periodStart.toISOString().slice(0, 10);
  const days = Math.round((run.periodEnd.getTime() - run.periodStart.getTime()) / 86_400_000) + 1;
  return { departmentId: run.departmentId, periodStart: start, weeks: Math.round(days / 7), payDate: run.payDate.toISOString().slice(0, 10), kind: run.kind === 'OFF_CYCLE' ? 'OFF_CYCLE' : 'REGULAR', note: run.note ?? null };
}

/** A second person checks and releases the run. It's recalculated first so year-to-date figures are current. */
export async function approveRun(tx: Tx, tenantId: string, runId: string, approverId: string, settings: PayrollSettings) {
  const run = await tx.payRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Pay run');
  if (run.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'Only a draft pay run can be approved.');
  if (settings.twoPersonApproval !== false) {
    if (run.preparedById === approverId) throw forbidden('Someone other than the person who prepared this pay run has to approve it.');
    // Nobody releases a one-time payment they added, or one that pays them.
    const own = await tx.payAdjustment.findFirst({ where: { payRunId: runId, OR: [{ createdById: approverId }, { userId: approverId }] } });
    if (own) throw forbidden('Someone else has to approve this pay run: it has a one-time item you added or that pays you.');
  }
  // In-app pay runs only while the organization runs payroll in the app.
  if (settings.payrollProvider && settings.payrollProvider.mode !== 'in_app') throw conflict('PAYROLL_WITH_PROVIDER', `Payroll runs with ${settings.payrollProvider.mode} for this organization: send the period from the Payroll provider tab, or switch back to payroll in the app.`);
  const fresh = await buildRun(tx, tenantId, run.preparedById, runInput(run), run.id);
  const blockers = fresh.blockers as unknown as Array<Issue | string>;
  if (blockers.length) throw new HttpError(409, 'RUN_BLOCKED', 'This pay run can’t be approved yet.', { blockers });
  const approved = await tx.payRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() } });
  const people = await tx.payStatement.findMany({ where: { payRunId: runId }, select: { id: true, userId: true, net: true, deductions: true } });
  // Expense claims on this run are paid now (and so drop out of any other draft run).
  const claimIds = people.flatMap((p) => ((p.deductions as { expenses?: Array<{ id: string }> }).expenses ?? []).map((e) => e.id));
  if (claimIds.length) await tx.expenseClaim.updateMany({ where: { id: { in: claimIds }, status: 'APPROVED' }, data: { status: 'PAID', payRunId: runId } });
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
