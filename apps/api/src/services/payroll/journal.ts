/**
 * Payroll accounting: each approved pay run as a balanced general-ledger entry,
 * and labour cost by department against budget.
 *
 * Debits (expense, by department GL segment): wages, employer CPP, employer EI,
 * employer benefit costs.
 * Credits (what the city owes): CPP and EI (employee + employer shares) and
 * income tax to CRA; for Quebec staff, QPP, QPIP and Quebec tax to Revenu Québec
 * (CRA still gets EI and federal tax); pension contributions to the plan, union dues to the
 * union, other benefit premiums to providers, and net pay to employees
 * (cleared by the bank deposit).
 */
import type { Tx } from '../../lib/db.js';
import type { Deductions } from './tax.js';

export const ACCOUNT_KEYS = ['wages', 'employerCpp', 'employerEi', 'employerBenefits', 'employerQpip', 'cppPayable', 'eiPayable', 'taxPayable', 'pensionPayable', 'unionDuesPayable', 'benefitsPayable', 'quebecPayable', 'netPayClearing'] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];
export type Accounts = Partial<Record<AccountKey, string>>;

/** Sensible placeholders until the city maps its own chart of accounts. */
export const DEFAULT_ACCOUNTS: Record<AccountKey, string> = {
  wages: '5100',
  employerCpp: '5110',
  employerEi: '5120',
  employerBenefits: '5130',
  employerQpip: '5125',
  cppPayable: '2210',
  eiPayable: '2220',
  taxPayable: '2230',
  pensionPayable: '2240',
  unionDuesPayable: '2250',
  benefitsPayable: '2260',
  quebecPayable: '2235',
  netPayClearing: '1010',
};

export const readAccounts = (raw: unknown): Record<AccountKey, string> => ({ ...DEFAULT_ACCOUNTS, ...((raw && typeof raw === 'object' ? (raw as { accounts?: Accounts }).accounts : {}) ?? {}) });

export interface JournalLine {
  account: string;
  key: AccountKey;
  segment: string | null;
  departmentId: string | null;
  debit: number;
  credit: number;
  description: string;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Extra = Deductions & { benefits?: Array<{ kind: string; employee: number; employer: number }> };

export async function payrollJournal(tx: Tx, runId: string) {
  const run = await tx.payRun.findUniqueOrThrow({ where: { id: runId } });
  const [statements, departments, tenant] = await Promise.all([
    tx.payStatement.findMany({ where: { payRunId: runId } }),
    tx.department.findMany({ select: { id: true, name: true, glCode: true } }),
    tx.tenant.findFirstOrThrow({ select: { accountingSettings: true } }),
  ]);
  const accounts = readAccounts(tenant.accountingSettings);
  const seg = (id: string | null) => departments.find((d) => d.id === id)?.glCode ?? null;
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? 'No department';
  const period = `${run.periodStart.toISOString().slice(0, 10)} to ${run.periodEnd.toISOString().slice(0, 10)}`;

  // Expenses by department.
  const byDept = new Map<string, { departmentId: string | null; wages: number; cpp: number; ei: number; qpip: number; benefits: number }>();
  const credits = { cppPayable: 0, eiPayable: 0, taxPayable: 0, quebecPayable: 0, pensionPayable: 0, unionDuesPayable: 0, benefitsPayable: 0, netPayClearing: 0 };
  for (const s of statements) {
    const d = s.deductions as unknown as Extra;
    const k = s.departmentId ?? 'none';
    const row = byDept.get(k) ?? { departmentId: s.departmentId, wages: 0, cpp: 0, ei: 0, qpip: 0, benefits: 0 };
    const employerBenefits = (d.benefits ?? []).reduce((a, b) => a + b.employer, 0);
    row.wages += Number(s.gross);
    row.cpp += Number(s.employerCpp);
    row.ei += Number(s.employerEi);
    row.benefits += employerBenefits;
    row.qpip += d.employerQpip ?? 0;
    byDept.set(k, row);
    credits.eiPayable += d.ei + Number(s.employerEi);
    if (d.plan === 'QPP') {
      // Quebec: QPP, QPIP and Quebec tax go to Revenu Québec; EI and federal tax to CRA.
      credits.quebecPayable += d.cpp + d.cpp2 + Number(s.employerCpp) + (d.qpip ?? 0) + (d.employerQpip ?? 0) + d.provincialTax;
      credits.taxPayable += d.federalTax + (d.extraTax ?? 0);
    } else {
      credits.cppPayable += d.cpp + d.cpp2 + Number(s.employerCpp);
      credits.taxPayable += d.federalTax + d.provincialTax + (d.extraTax ?? 0);
    }
    for (const b of d.benefits ?? []) {
      if (b.kind === 'PENSION') credits.pensionPayable += b.employee + b.employer;
      else if (b.kind === 'UNION_DUES') credits.unionDuesPayable += b.employee + b.employer;
      else credits.benefitsPayable += b.employee + b.employer;
    }
    credits.netPayClearing += Number(s.net);
  }

  const lines: JournalLine[] = [];
  const debit = (key: AccountKey, departmentId: string | null, amount: number, what: string) => {
    if (r2(amount)) lines.push({ account: accounts[key], key, segment: seg(departmentId), departmentId, debit: r2(amount), credit: 0, description: `${what}, ${deptName(departmentId)}, ${period}` });
  };
  for (const row of byDept.values()) {
    debit('wages', row.departmentId, row.wages, 'Wages');
    debit('employerCpp', row.departmentId, row.cpp, 'Employer CPP');
    debit('employerEi', row.departmentId, row.ei, 'Employer EI');
    debit('employerQpip', row.departmentId, row.qpip, 'Employer QPIP');
    debit('employerBenefits', row.departmentId, row.benefits, 'Employer benefits');
  }
  const LABELS: Record<keyof typeof credits, string> = {
    cppPayable: 'CPP owing to CRA',
    eiPayable: 'EI owing to CRA',
    taxPayable: 'Income tax owing to CRA',
    quebecPayable: 'QPP, QPIP and Quebec tax owing to Revenu Québec',
    pensionPayable: 'Pension contributions owing',
    unionDuesPayable: 'Union dues owing',
    benefitsPayable: 'Benefit premiums owing',
    netPayClearing: 'Net pay to employees',
  };
  for (const [key, amount] of Object.entries(credits) as Array<[keyof typeof credits, number]>) {
    if (r2(amount)) lines.push({ account: accounts[key], key, segment: null, departmentId: null, debit: 0, credit: r2(amount), description: `${LABELS[key]}, ${period}` });
  }
  const totalDebit = r2(lines.reduce((a, l) => a + l.debit, 0));
  const totalCredit = r2(lines.reduce((a, l) => a + l.credit, 0));
  return { runId, date: run.payDate.toISOString().slice(0, 10), period, lines, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 };
}

export function journalCsv(j: Awaited<ReturnType<typeof payrollJournal>>): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Account', 'Segment', 'Debit', 'Credit', 'Description', 'Reference'];
  const rows = j.lines.map((l) => [j.date, l.account, l.segment ?? '', l.debit ? l.debit.toFixed(2) : '', l.credit ? l.credit.toFixed(2) : '', l.description, `FH-PAYRUN-${j.runId.slice(0, 8)}`].map(q).join(','));
  return [head.map(q).join(','), ...rows].join('\r\n');
}

/** Labour cost by department and month for a year (approved and paid runs), against each department's budget. */
export async function labourCost(tx: Tx, year: number, onlyDepartments: string[] | null = null) {
  const [rows, departments] = await Promise.all([
    tx.payStatement.findMany({ where: { year, payRun: { status: { in: ['APPROVED', 'PAID'] } } }, select: { departmentId: true, payDate: true, gross: true, employerCpp: true, employerEi: true, deductions: true } }),
    tx.department.findMany({ select: { id: true, name: true, nameFr: true, glCode: true, labourBudget: true }, orderBy: { name: 'asc' } }),
  ]);
  const out = new Map<string, { departmentId: string | null; months: number[]; wages: number; employerCosts: number; total: number }>();
  for (const s of rows) {
    if (onlyDepartments && !onlyDepartments.includes(s.departmentId ?? '')) continue;
    const k = s.departmentId ?? 'none';
    const row = out.get(k) ?? { departmentId: s.departmentId, months: Array(12).fill(0), wages: 0, employerCosts: 0, total: 0 };
    const employer = Number(s.employerCpp) + Number(s.employerEi) + ((s.deductions as { employerBenefits?: number; employerQpip?: number }).employerBenefits ?? 0) + ((s.deductions as { employerQpip?: number }).employerQpip ?? 0);
    const cost = Number(s.gross) + employer;
    row.months[s.payDate.getUTCMonth()] = r2(row.months[s.payDate.getUTCMonth()]! + cost);
    row.wages = r2(row.wages + Number(s.gross));
    row.employerCosts = r2(row.employerCosts + employer);
    row.total = r2(row.total + cost);
    out.set(k, row);
  }
  return {
    year,
    departments: [...out.values()].map((r) => {
      const d = departments.find((x) => x.id === r.departmentId);
      const budget = d?.labourBudget != null ? Number(d.labourBudget) : null;
      return { ...r, name: d?.name ?? null, nameFr: d?.nameFr ?? null, glCode: d?.glCode ?? null, budget, used: budget ? r2((r.total / budget) * 100) : null };
    }),
    budgets: departments.map((d) => ({ id: d.id, name: d.name, nameFr: d.nameFr, glCode: d.glCode, labourBudget: d.labourBudget != null ? Number(d.labourBudget) : null })),
  };
}
