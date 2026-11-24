import { describe, expect, it } from 'vitest';
import { canVoid } from './payroll';

const holds = (...p: string[]) => (x: string) => p.includes(x);

describe('voiding a pay run', () => {
  it('a preparer (payroll.export) can void a draft made for the wrong period; an approved run needs an approver', () => {
    expect(canVoid('DRAFT', holds('payroll.export'))).toBe(true);
    expect(canVoid('APPROVED', holds('payroll.export'))).toBe(false);
    expect(canVoid('APPROVED', holds('payroll.export', 'payroll.approve'))).toBe(true);
    expect(canVoid('PAID', holds('payroll.export', 'payroll.approve'))).toBe(false);
  });
});
