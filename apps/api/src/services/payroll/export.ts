/**
 * Payroll export (CSV) for the employer's payroll system (ADP, Ceridian Dayforce,
 * Tyler, Wagepoint, ...). Flexcity is the time-and-attendance ledger; the payroll
 * provider computes CPP/QPP, EI, QPIP, income tax and issues T4/RL-1 slips.
 * Flexcity deliberately does NOT generate T4s and does NOT store SINs.
 *
 * Validation is strict: an export with a missing employee number, pay-code
 * mapping or cost centre is refused with a list of every problem, rather than
 * producing a file that silently mis-pays someone.
 */
import type { PayCodeKey } from '@prisma/client';
import type { PayLine } from './payCalc.js';
import { type Issue, issue } from './issues.js';

export interface ExportEmployee {
  userId: string;
  employeeNumber: string | null;
  displayName: string;
  costCenter: string | null;
  lines: PayLine[];
}

export interface PayCodeLookup {
  /** Position-specific mapping first, then the default (positionId null). */
  resolve(key: PayCodeKey, positionId: string | null): string | null;
}

export type ExportResult = { ok: true; csv: string; rowCount: number } | { ok: false; problems: Issue[] };

const HEADER = ['Employee_ID', 'Pay_Code', 'Hours', 'Rate', 'Amount', 'Cost_Center', 'Period_Start', 'Period_End'];

export function buildPayrollCsv(employees: ExportEmployee[], codes: PayCodeLookup, period: { start: string; end: string }): ExportResult {
  const problems: Issue[] = [];
  const rows: string[][] = [];

  for (const e of employees) {
    if (!e.employeeNumber) problems.push(issue('NO_EMPLOYEE_NUMBER', { name: e.displayName }));
    if (!e.costCenter) problems.push(issue('NO_COST_CENTRE', { name: e.displayName }));
    for (const l of e.lines) {
      const code = codes.resolve(l.code, l.positionId);
      if (!code) {
        problems.push(issue('NO_PAY_CODE', { name: e.displayName, code: l.code }));
        continue;
      }
      rows.push([
        e.employeeNumber ?? '',
        code,
        l.hours.toFixed(2),
        l.rate.toFixed(2),
        l.amount.toFixed(2),
        e.costCenter ?? '',
        period.start,
        period.end,
      ]);
    }
  }

  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  const csv = [HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { ok: true, csv, rowCount: rows.length };
}

/** RFC 4180 quoting, plus neutralising spreadsheet formula injection. */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
