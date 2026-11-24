import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildPayrollCsv } from '../../src/services/payroll/export.js';

// An expense reimbursement is an amount with no hours or rate, in every provider's layout.
const ZERO = new Decimal(0);
const employees = [{ userId: 'u1', employeeNumber: 'E1', displayName: 'Guard One', costCenter: 'CC-1', lines: [{ code: 'REIMBURSEMENT' as const, positionId: null, hours: ZERO, rate: ZERO, multiplier: ZERO, amount: new Decimal('42.50') }] }];
const codes = { resolve: () => 'REI' };
const period = { start: '2026-03-09', end: '2026-03-15' };
const rows = (csv: string) => csv.trim().split('\r\n').map((l) => l.split(','));

describe('expense reimbursements in provider files', () => {
  it('ADP: an earnings amount (Earnings 3), with no hours and no temporary rate', () => {
    const r = buildPayrollCsv(employees, codes, period, { format: 'adp', adpCompanyCode: 'ABC', adpBatchId: '0320' });
    expect(r.ok).toBe(true);
    const [head, row] = rows(r.ok ? r.csv : '');
    const col = (name: string) => row![head!.indexOf(name)];
    expect(col('Earnings 3 Code')).toBe('REI');
    expect(col('Earnings 3 Amount')).toBe('42.50');
    expect(col('Reg Hours')).toBe('');
    expect(col('O/T Hours')).toBe('');
    expect(col('Hours 3 Code')).toBe('');
    expect(col('Temp Rate')).toBe('');
  });

  it('Dayforce: blank hours and rate, the amount only', () => {
    const r = buildPayrollCsv(employees, codes, period, { format: 'dayforce' });
    const [head, row] = rows(r.ok ? r.csv : '');
    const col = (name: string) => row![head!.indexOf(name)];
    expect(col('PayAdjCodeXRefCode')).toBe('REI');
    expect(col('NetHours')).toBe('');
    expect(col('Rate')).toBe('');
    expect(col('Amount')).toBe('42.50');
  });
});
