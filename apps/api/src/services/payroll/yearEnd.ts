/**
 * Payroll documents built from approved and paid statements:
 * - the monthly source-deduction remittance (what goes to CRA with a PD7A),
 * - the monthly Quebec remittance to Revenu Québec (QPP, QPIP, Quebec tax),
 * - T4 slips and the T4 Summary for the year, and RL-1 slips for Quebec staff,
 * - Record of Employment figures (insurable earnings and hours by pay period).
 */
import type { Tx } from '../../lib/db.js';
import { readSettings } from './payRuns.js';
import { statementHours } from './statementHours.js';
import { type Deductions, hsfRate } from './tax.js';
import { loadTaxTables } from './taxTables.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const PAID = { status: { in: ['APPROVED', 'PAID'] as Array<'APPROVED' | 'PAID'> } };

/** Source deductions withheld in a month, due to CRA by the 15th of the next month (regular remitters). */
export async function remittance(tx: Tx, month: string) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const rows = await tx.payStatement.findMany({ where: { payDate: { gte: start, lt: end }, payRun: PAID } });
  const t = { grossPayroll: 0, cppEmployee: 0, cppEmployer: 0, eiEmployee: 0, eiEmployer: 0, incomeTax: 0, total: 0 };
  // Quebec staff: QPP, QPIP and Quebec tax go to Revenu Québec, not CRA.
  const qc = { grossPayroll: 0, qppEmployee: 0, qppEmployer: 0, qpipEmployee: 0, qpipEmployer: 0, quebecTax: 0, total: 0 };
  // Amounts owed to each benefit provider (pension plan, insurer, union) for the month.
  const plans = new Map<string, { planId: string; name: string; kind: string; employee: number; employer: number }>();
  for (const s of rows) {
    const d = s.deductions as unknown as Deductions;
    t.grossPayroll += Number(s.gross);
    t.eiEmployee += d.ei;
    t.eiEmployer += Number(s.employerEi);
    if (d.plan === 'QPP') {
      qc.grossPayroll += Number(s.gross);
      qc.qppEmployee += d.cpp + d.cpp2;
      qc.qppEmployer += Number(s.employerCpp);
      qc.qpipEmployee += d.qpip ?? 0;
      qc.qpipEmployer += d.employerQpip ?? 0;
      qc.quebecTax += d.provincialTax;
      t.incomeTax += d.federalTax + (d.extraTax ?? 0);
    } else {
      t.cppEmployee += d.cpp + d.cpp2;
      t.cppEmployer += Number(s.employerCpp);
      t.incomeTax += d.federalTax + d.provincialTax + (d.extraTax ?? 0);
    }
    for (const b of (d as unknown as { benefits?: Array<{ planId: string; name: string; kind: string; employee: number; employer: number }> }).benefits ?? []) {
      const row = plans.get(b.planId) ?? { planId: b.planId, name: b.name, kind: b.kind, employee: 0, employer: 0 };
      row.employee = r2(row.employee + b.employee);
      row.employer = r2(row.employer + b.employer);
      plans.set(b.planId, row);
    }
  }
  t.total = t.cppEmployee + t.cppEmployer + t.eiEmployee + t.eiEmployer + t.incomeTax;
  for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] = r2(t[k]);
  qc.total = qc.qppEmployee + qc.qppEmployer + qc.qpipEmployee + qc.qpipEmployer + qc.quebecTax;
  for (const k of Object.keys(qc) as Array<keyof typeof qc>) qc[k] = r2(qc[k]);
  const lastPay = rows.reduce<Date | null>((m, s) => (!m || s.payDate > m ? s.payDate : m), null);
  const employeesLastPay = lastPay ? new Set(rows.filter((s) => s.payDate.getTime() === lastPay.getTime()).map((s) => s.userId)).size : 0;
  const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 15)).toISOString().slice(0, 10);
  return {
    month,
    due,
    statements: rows.length,
    employeesLastPay,
    ...t,
    benefitsByPlan: [...plans.values()],
    revenuQuebec: qc.grossPayroll ? { ...qc, ...(await healthServicesFund(tx, start, qc.grossPayroll)), due } : null,
  };
}

const qcEarnings = (s: { gross: unknown; deductions: unknown }) => Number(s.gross) + ((s.deductions as { taxableBenefit?: number }).taxableBenefit ?? 0);

/**
 * The Health Services Fund for a month's Quebec payroll, remitted with the source deductions.
 * The rate depends on the year's total payroll (public bodies pay the top rate); during the year it's
 * estimated from the payroll so far, annualized, and settled on the RLZ-1.S.
 */
async function healthServicesFund(tx: Tx, monthStart: Date, monthPayroll: number) {
  const year = monthStart.getUTCFullYear();
  const table = (await loadTaxTables(tx, year)).quebec?.data.employer;
  if (!table) return { hsf: null };
  const sector = readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings).quebecSector ?? 'public';
  const end = new Date(Date.UTC(year, monthStart.getUTCMonth() + 1, 1));
  const ytd = (await tx.payStatement.findMany({ where: { year, payDate: { lt: end }, payRun: PAID } })).filter((s) => (s.deductions as unknown as Deductions).plan === 'QPP');
  const annualized = (ytd.reduce((a, s) => a + qcEarnings(s), 0) / (monthStart.getUTCMonth() + 1)) * 12;
  const rate = hsfRate(table.hsf, annualized, sector);
  return { hsf: { rate: Math.round(rate * 1e6) / 1e6, sector, estimatedAnnualPayroll: r2(annualized), amount: r2(monthPayroll * rate) } };
}

export interface T4Slip {
  userId: string;
  name: string;
  employeeNumber: string | null;
  sin: string | null;
  province: string;
  box14EmploymentIncome: number;
  box16Cpp: number;
  box16aCpp2: number;
  /** Quebec: QPP instead of CPP (boxes 17 / 17A), QPIP (55, 56). */
  box17Qpp: number;
  box17aQpp2: number;
  box55Ppip: number;
  box56PpipInsurable: number;
  box18Ei: number;
  box22IncomeTax: number;
  box24EiInsurable: number;
  box26CppPensionable: number;
  box20Rpp: number;
  box40TaxableBenefits: number;
  box44UnionDues: number;
}

/** T4 slips for everyone paid in the year, and the T4 Summary totals. */
export async function t4s(tx: Tx, year: number) {
  const rows = await tx.payStatement.findMany({ where: { year, payRun: PAID }, orderBy: { payDate: 'asc' } });
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, payProfile: { select: { sinLast3: true } } } });
  const slips = new Map<string, T4Slip>();
  let employerCpp = 0;
  let employerEi = 0;
  for (const s of rows) {
    const u = users.find((x) => x.id === s.userId)!;
    const d = s.deductions as unknown as Deductions;
    const slip =
      slips.get(s.userId) ??
      ({
        userId: s.userId,
        name: `${u.lastName}, ${u.firstName}`,
        employeeNumber: u.employeeNumber,
        sin: u.payProfile?.sinLast3 ? `•••-•••-${u.payProfile.sinLast3}` : null,
        province: s.province,
        box14EmploymentIncome: 0,
        box16Cpp: 0,
        box16aCpp2: 0,
        box17Qpp: 0,
        box17aQpp2: 0,
        box55Ppip: 0,
        box56PpipInsurable: 0,
        box18Ei: 0,
        box22IncomeTax: 0,
        box24EiInsurable: 0,
        box26CppPensionable: 0,
        box20Rpp: 0,
        box40TaxableBenefits: 0,
        box44UnionDues: 0,
      } satisfies T4Slip);
    slip.province = s.province; // province of employment at year end
    const b = d as unknown as { rpp?: number; unionDues?: number; taxableBenefit?: number };
    // Box 14 includes taxable benefits (box 40) as well as cash pay.
    slip.box14EmploymentIncome += Number(s.gross) + (b.taxableBenefit ?? 0);
    slip.box20Rpp += b.rpp ?? 0;
    slip.box40TaxableBenefits += b.taxableBenefit ?? 0;
    slip.box44UnionDues += b.unionDues ?? 0;
    if (d.plan === 'QPP') {
      slip.box17Qpp += d.cpp;
      slip.box17aQpp2 += d.cpp2;
      slip.box55Ppip += d.qpip ?? 0;
      slip.box56PpipInsurable += d.qpipInsurable ?? 0;
      // Box 22 is federal tax only; Quebec tax goes on the RL-1.
      slip.box22IncomeTax += d.federalTax + (d.extraTax ?? 0);
    } else {
      slip.box16Cpp += d.cpp;
      slip.box16aCpp2 += d.cpp2;
      slip.box22IncomeTax += d.federalTax + d.provincialTax + (d.extraTax ?? 0);
    }
    slip.box18Ei += d.ei;
    slip.box24EiInsurable += d.insurable ?? 0;
    slip.box26CppPensionable += d.pensionable ?? 0;
    slips.set(s.userId, slip);
    employerCpp += Number(s.employerCpp);
    employerEi += Number(s.employerEi);
  }
  const list = [...slips.values()].map((s) => ({
    ...s,
    box14EmploymentIncome: r2(s.box14EmploymentIncome),
    box16Cpp: r2(s.box16Cpp),
    box16aCpp2: r2(s.box16aCpp2),
    box17Qpp: r2(s.box17Qpp),
    box17aQpp2: r2(s.box17aQpp2),
    box55Ppip: r2(s.box55Ppip),
    box56PpipInsurable: r2(s.box56PpipInsurable),
    box18Ei: r2(s.box18Ei),
    box22IncomeTax: r2(s.box22IncomeTax),
    box24EiInsurable: r2(s.box24EiInsurable),
    box26CppPensionable: r2(s.box26CppPensionable),
    box20Rpp: r2(s.box20Rpp),
    box40TaxableBenefits: r2(s.box40TaxableBenefits),
    box44UnionDues: r2(s.box44UnionDues),
  }));
  const sum = (k: keyof T4Slip) => r2(list.reduce((a, s) => a + (s[k] as number), 0));
  return {
    year,
    slips: list.sort((a, b) => a.name.localeCompare(b.name)),
    summary: {
      slips: list.length,
      box14: sum('box14EmploymentIncome'),
      box16: sum('box16Cpp'),
      box16a: sum('box16aCpp2'),
      box17: sum('box17Qpp'),
      box17a: sum('box17aQpp2'),
      box55: sum('box55Ppip'),
      box18: sum('box18Ei'),
      box19EmployerEi: r2(employerEi),
      box22: sum('box22IncomeTax'),
      box27EmployerCpp: r2(employerCpp),
      box20: sum('box20Rpp'),
      box44: sum('box44UnionDues'),
      missingSin: list.filter((s) => !s.sin).map((s) => s.name),
    },
  };
}

export interface Rl1Slip {
  userId: string;
  name: string;
  employeeNumber: string | null;
  sin: string | null;
  /** A: employment income (cash pay and taxable benefits). */
  boxA: number;
  /** B.A: QPP base and first additional contributions; B.B: second additional (QPP2). */
  boxBA: number;
  boxBB: number;
  /** C: EI premiums. */
  boxC: number;
  /** D: registered pension plan contributions. */
  boxD: number;
  /** E: Quebec income tax withheld. */
  boxE: number;
  /** F: union dues. */
  boxF: number;
  /** G: pensionable salary under the QPP. */
  boxG: number;
  /** H: QPIP premiums. I: salary insurable under the QPIP. */
  boxH: number;
  boxI: number;
  /** L: taxable benefits included in A. */
  boxL: number;
}

/** RL-1 slips for everyone paid as a Quebec employee in the year, and RLZ-1.S summary totals. */
export async function rl1s(tx: Tx, year: number) {
  const rows = (await tx.payStatement.findMany({ where: { year, province: 'QC', payRun: PAID }, orderBy: { payDate: 'asc' } })).filter((s) => (s.deductions as unknown as Deductions).plan === 'QPP');
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, payProfile: { select: { sinLast3: true } } } });
  const slips = new Map<string, Rl1Slip>();
  let employerQpp = 0;
  let employerQpip = 0;
  for (const s of rows) {
    const u = users.find((x) => x.id === s.userId)!;
    const d = s.deductions as unknown as Deductions & { rpp?: number; unionDues?: number; taxableBenefit?: number };
    const slip =
      slips.get(s.userId) ??
      ({ userId: s.userId, name: `${u.lastName}, ${u.firstName}`, employeeNumber: u.employeeNumber, sin: u.payProfile?.sinLast3 ? `•••-•••-${u.payProfile.sinLast3}` : null, boxA: 0, boxBA: 0, boxBB: 0, boxC: 0, boxD: 0, boxE: 0, boxF: 0, boxG: 0, boxH: 0, boxI: 0, boxL: 0 } satisfies Rl1Slip);
    slip.boxA += Number(s.gross) + (d.taxableBenefit ?? 0);
    slip.boxBA += d.cpp;
    slip.boxBB += d.cpp2;
    slip.boxC += d.ei;
    slip.boxD += d.rpp ?? 0;
    slip.boxE += d.provincialTax;
    slip.boxF += d.unionDues ?? 0;
    slip.boxG += d.pensionable ?? 0;
    slip.boxH += d.qpip ?? 0;
    slip.boxI += d.qpipInsurable ?? 0;
    slip.boxL += d.taxableBenefit ?? 0;
    slips.set(s.userId, slip);
    employerQpp += Number(s.employerCpp);
    employerQpip += d.employerQpip ?? 0;
  }
  const keys = ['boxA', 'boxBA', 'boxBB', 'boxC', 'boxD', 'boxE', 'boxF', 'boxG', 'boxH', 'boxI', 'boxL'] as const;
  const list = [...slips.values()].map((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, r2(s[k])])) }) as Rl1Slip);
  const sum = (k: (typeof keys)[number]) => r2(list.reduce((a, s) => a + s[k], 0));
  return {
    year,
    slips: list.sort((a, b) => a.name.localeCompare(b.name)),
    summary: {
      slips: list.length,
      ...Object.fromEntries(keys.map((k) => [k, sum(k)])),
      employerQpp: r2(employerQpp),
      employerQpip: r2(employerQpip),
      ...(await employerContributions(tx, year, rows)),
      missingSin: list.filter((s) => !s.sin).map((s) => s.name),
    },
  };
}

/** The year's employer-only Quebec contributions for the RLZ-1.S: Health Services Fund, labour standards (CNT), workforce skills (WSDRF). */
async function employerContributions(tx: Tx, year: number, rows: Array<{ userId: string; gross: unknown; deductions: unknown }>) {
  const q = (await loadTaxTables(tx, year)).quebec?.data;
  if (!q?.employer) return { contributions: null };
  const sector = readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings).quebecSector ?? 'public';
  const payroll = rows.reduce((a, s) => a + qcEarnings(s), 0);
  const perPerson = new Map<string, number>();
  for (const s of rows) perPerson.set(s.userId, (perPerson.get(s.userId) ?? 0) + qcEarnings(s));
  const cntBase = [...perPerson.values()].reduce((a, v) => a + Math.min(v, q.qpip.maxInsurable), 0);
  const rate = hsfRate(q.employer.hsf, payroll, sector);
  return {
    contributions: {
      sector,
      payroll: r2(payroll),
      hsfRate: Math.round(rate * 1e6) / 1e6,
      hsf: r2(payroll * rate),
      cnt: r2(cntBase * q.employer.cntRate),
      ...(await workforceSkills(tx, year, payroll, q.employer.wsdrf)),
    },
  };
}

/**
 * Workforce skills (WSDRF): an employer whose payroll is over the threshold must spend the rate
 * (1%) on eligible training, or pay the difference to the fund on the RLZ-1.S (Form LE-39.0.2).
 * The spending comes from the training log (`TrainingSpend`).
 */
export async function workforceSkills(tx: Tx, year: number, payroll: number, wsdrf: { rate: number; threshold: number }) {
  const subject = payroll > wsdrf.threshold;
  const required = subject ? r2(payroll * wsdrf.rate) : 0;
  const spent = r2(((await tx.trainingSpend.aggregate({ where: { year }, _sum: { amountCents: true } }))._sum.amountCents ?? 0) / 100);
  return {
    wsdrfSubject: subject,
    wsdrfThreshold: wsdrf.threshold,
    wsdrfBeforeTraining: required,
    trainingSpent: spent,
    /** What's left to pay the fund: the 1% less eligible training, never below zero. */
    wsdrfOwed: r2(Math.max(0, required - spent)),
    /** Spending beyond the 1% can be carried to later years. */
    trainingSurplus: subject ? r2(Math.max(0, spent - required)) : 0,
  };
}

/** Figures for a Record of Employment: insurable earnings and hours per pay period, newest first (last 53 weeks). */
export async function roeFigures(tx: Tx, userId: string) {
  const since = new Date(Date.now() - 53 * 7 * 86_400_000);
  const rows = await tx.payStatement.findMany({ where: { userId, payDate: { gte: since }, payRun: PAID }, include: { payRun: { select: { periodStart: true, periodEnd: true } } }, orderBy: { payDate: 'desc' } });
  const periods = rows.map((s) => ({
    periodStart: s.payRun.periodStart.toISOString().slice(0, 10),
    periodEnd: s.payRun.periodEnd.toISOString().slice(0, 10),
    insurableEarnings: r2((s.deductions as unknown as Deductions).insurable ?? Number(s.gross)),
    hours: statementHours(s.earnings, Number(s.hours)),
  }));
  return {
    userId,
    periods,
    totalInsurableEarnings: r2(periods.reduce((a, p) => a + p.insurableEarnings, 0)),
    totalInsurableHours: r2(periods.reduce((a, p) => a + p.hours, 0)),
    firstDay: periods.at(-1)?.periodStart ?? null,
    lastPaidDay: periods[0]?.periodEnd ?? null,
  };
}
