/**
 * Payroll export (CSV) for cities that pay through a payroll provider instead of
 * FlexcityHeadquarters' own pay runs. FH is then the time-and-attendance ledger and
 * the provider computes deductions and issues slips.
 *
 * Layouts:
 * - generic: one row per employee, pay code and position;
 * - adp: ADP Workforce Now pay data import (Co Code, Batch ID, File #, Reg / O/T hours,
 *   other hours and earnings by code);
 * - dayforce: Ceridian Dayforce pay adjustment import (XRef codes);
 * - wagepoint: Wagepoint hours import.
 * Providers let each customer adjust column names, so check the first file against the
 * import template your provider gave you.
 *
 * Validation is strict: an export with a missing employee number, pay-code
 * mapping or cost centre is refused with a list of every problem, rather than
 * producing a file that silently mis-pays someone.
 */
import type { PayCodeKey } from '../../generated/prisma/client.js';
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

export const EXPORT_FORMATS = ['generic', 'adp', 'dayforce', 'wagepoint'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export interface ExportOptions {
  format?: ExportFormat;
  /** ADP company code (3 characters) and batch ID. */
  adpCompanyCode?: string | null;
  adpBatchId?: string | null;
}

interface Row { employee: string; key: PayCodeKey; code: string; hours: number; rate: number; amount: number; costCenter: string }

/** Lines ADP gets as earnings amounts even when they carry hours (premiums on hours paid elsewhere). */
const AMOUNT_ONLY: ReadonlySet<PayCodeKey> = new Set(['SCHEDULE_CHANGE_PREMIUM']);

const HEADER = ['Employee_ID', 'Pay_Code', 'Hours', 'Rate', 'Amount', 'Cost_Center', 'Period_Start', 'Period_End'];
const n2 = (n: number) => n.toFixed(2);

const LAYOUTS: Record<ExportFormat, { header: string[]; row: (r: Row, period: { start: string; end: string }, o: ExportOptions) => string[] }> = {
  generic: { header: HEADER, row: (r, p) => [r.employee, r.code, n2(r.hours), n2(r.rate), n2(r.amount), r.costCenter, p.start, p.end] },
  adp: {
    header: ['Co Code', 'Batch ID', 'File #', 'Temp Dept', 'Temp Rate', 'Reg Hours', 'O/T Hours', 'Hours 3 Code', 'Hours 3 Amount', 'Earnings 3 Code', 'Earnings 3 Amount'],
    row: (r, _p, o) => {
      const base = [o.adpCompanyCode ?? '', o.adpBatchId ?? '', r.employee, r.costCenter, r.hours && !AMOUNT_ONLY.has(r.key) ? n2(r.rate) : ''];
      // Regular and time-and-a-half hours go in their own columns; other hours by code; amounts without hours as earnings.
      if (r.key === 'REGULAR') return [...base, n2(r.hours), '', '', '', '', ''];
      if (r.key === 'OVERTIME_1_5') return [...base, '', n2(r.hours), '', '', '', ''];
      // A late-change premium is the extra part only ((multiplier − 1) × rate on the changed
      // hours): sent as its amount, so ADP doesn't pay the hours again at the full rate.
      if (r.hours && !AMOUNT_ONLY.has(r.key)) return [...base, '', '', r.code, n2(r.hours), '', ''];
      return [...base, '', '', '', '', r.code, n2(r.amount)];
    },
  },
  dayforce: {
    header: ['EmployeeXRefCode', 'PayAdjCodeXRefCode', 'EffectiveDate', 'NetHours', 'Rate', 'Amount', 'OrgUnitXRefCode', 'Comment'],
    row: (r, p) => [r.employee, r.code, p.end, r.hours ? n2(r.hours) : '', r.hours ? n2(r.rate) : '', n2(r.amount), r.costCenter, `FlexcityHeadquarters ${p.start} to ${p.end}`],
  },
  wagepoint: {
    header: ['Employee Number', 'Earning Code', 'Hours', 'Rate', 'Amount', 'Department', 'Period Start', 'Period End'],
    row: (r, p) => [r.employee, r.code, r.hours ? n2(r.hours) : '', r.hours ? n2(r.rate) : '', n2(r.amount), r.costCenter, p.start, p.end],
  },
};

export function buildPayrollCsv(employees: ExportEmployee[], codes: PayCodeLookup, period: { start: string; end: string }, options: ExportOptions = {}): ExportResult {
  const format = options.format ?? 'generic';
  const problems: Issue[] = [];
  const rows: Row[] = [];
  if (format === 'adp' && !/^[A-Za-z0-9]{3}$/.test(options.adpCompanyCode ?? '')) problems.push(issue('ADP_COMPANY_CODE'));

  for (const e of employees) {
    if (!e.employeeNumber) problems.push(issue('NO_EMPLOYEE_NUMBER', { name: e.displayName }));
    if (!e.costCenter) problems.push(issue('NO_COST_CENTRE', { name: e.displayName }));
    for (const l of e.lines) {
      const code = codes.resolve(l.code, l.positionId);
      if (!code) {
        problems.push(issue('NO_PAY_CODE', { name: e.displayName, code: l.code }));
        continue;
      }
      rows.push({ employee: e.employeeNumber ?? '', key: l.code, code, hours: Number(l.hours), rate: Number(l.rate), amount: Number(l.amount), costCenter: e.costCenter ?? '' });
    }
  }

  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  const layout = LAYOUTS[format];
  const csv = [layout.header, ...rows.map((r) => layout.row(r, period, options))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { ok: true, csv, rowCount: rows.length };
}

/** RFC 4180 quoting, plus neutralising spreadsheet formula injection. */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
