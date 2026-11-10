/**
 * Payroll documents built from approved and paid statements:
 * - the monthly source-deduction remittance (what goes to CRA with a PD7A),
 * - T4 slips and the T4 Summary for the year,
 * - Record of Employment figures (insurable earnings and hours by pay period).
 */
import type { Tx } from '../../lib/db.js';
import type { Deductions } from './tax.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const PAID = { status: { in: ['APPROVED', 'PAID'] as Array<'APPROVED' | 'PAID'> } };

/** Source deductions withheld in a month, due to CRA by the 15th of the next month (regular remitters). */
export async function remittance(tx: Tx, month: string) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const rows = await tx.payStatement.findMany({ where: { payDate: { gte: start, lt: end }, payRun: PAID } });
  const t = { grossPayroll: 0, cppEmployee: 0, cppEmployer: 0, eiEmployee: 0, eiEmployer: 0, incomeTax: 0, total: 0 };
  // Amounts owed to each benefit provider (pension plan, insurer, union) for the month.
  const plans = new Map<string, { planId: string; name: string; kind: string; employee: number; employer: number }>();
  for (const s of rows) {
    const d = s.deductions as unknown as Deductions;
    t.grossPayroll += Number(s.gross);
    t.cppEmployee += d.cpp + d.cpp2;
    t.cppEmployer += Number(s.employerCpp);
    t.eiEmployee += d.ei;
    t.eiEmployer += Number(s.employerEi);
    t.incomeTax += d.federalTax + d.provincialTax + (d.extraTax ?? 0);
    for (const b of (d as unknown as { benefits?: Array<{ planId: string; name: string; kind: string; employee: number; employer: number }> }).benefits ?? []) {
      const row = plans.get(b.planId) ?? { planId: b.planId, name: b.name, kind: b.kind, employee: 0, employer: 0 };
      row.employee = r2(row.employee + b.employee);
      row.employer = r2(row.employer + b.employer);
      plans.set(b.planId, row);
    }
  }
  t.total = t.cppEmployee + t.cppEmployer + t.eiEmployee + t.eiEmployer + t.incomeTax;
  for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] = r2(t[k]);
  const lastPay = rows.reduce<Date | null>((m, s) => (!m || s.payDate > m ? s.payDate : m), null);
  const employeesLastPay = lastPay ? new Set(rows.filter((s) => s.payDate.getTime() === lastPay.getTime()).map((s) => s.userId)).size : 0;
  const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 15)).toISOString().slice(0, 10);
  return { month, due, statements: rows.length, employeesLastPay, ...t, benefitsByPlan: [...plans.values()] };
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
    slip.box16Cpp += d.cpp;
    slip.box16aCpp2 += d.cpp2;
    slip.box18Ei += d.ei;
    slip.box22IncomeTax += d.federalTax + d.provincialTax + (d.extraTax ?? 0);
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

/** Figures for a Record of Employment: insurable earnings and hours per pay period, newest first (last 53 weeks). */
export async function roeFigures(tx: Tx, userId: string) {
  const since = new Date(Date.now() - 53 * 7 * 86_400_000);
  const rows = await tx.payStatement.findMany({ where: { userId, payDate: { gte: since }, payRun: PAID }, include: { payRun: { select: { periodStart: true, periodEnd: true } } }, orderBy: { payDate: 'desc' } });
  const periods = rows.map((s) => ({
    periodStart: s.payRun.periodStart.toISOString().slice(0, 10),
    periodEnd: s.payRun.periodEnd.toISOString().slice(0, 10),
    insurableEarnings: r2((s.deductions as unknown as Deductions).insurable ?? Number(s.gross)),
    hours: Number(s.hours),
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
