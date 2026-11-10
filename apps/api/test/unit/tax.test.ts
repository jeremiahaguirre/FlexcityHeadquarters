import { describe, expect, it } from 'vitest';
import { bracketTax, calculateDeductions, calculateQuebecDeductions, hsfRate, federalBasicPersonal, type FederalTable, type ProvincialTable, type QuebecTable } from '../../src/services/payroll/tax.js';

// A made-up table with round numbers, to check the method (not CRA's values).
const fed: FederalTable = {
  cpp: { rate: 0.05, basicExemption: 3500, ympe: 70000, baseRate: 0.04 },
  cpp2: { rate: 0.04, yampe: 80000 },
  ei: { rate: 0.02, maxInsurable: 60000, employerMultiplier: 1.4 },
  brackets: [
    { upTo: 50000, rate: 0.15 },
    { upTo: 100000, rate: 0.2 },
    { upTo: null, rate: 0.3 },
  ],
  basicPersonal: { max: 15000, min: 14000, phaseOutFrom: 150000, phaseOutTo: 200000 },
  cea: 1000,
};
const prov: ProvincialTable = { brackets: [{ upTo: 40000, rate: 0.05 }, { upTo: null, rate: 0.1 }], basicPersonal: 10000 };
const zero = { gross: 0, pensionable: 0, cpp: 0, cpp2: 0, insurable: 0, ei: 0 };
const base = { periodsPerYear: 26, ytd: zero, federal: fed, provincial: prov, federalClaim: null, provincialClaim: null, extraTax: 0, cppExempt: false, eiExempt: false };

describe('payroll deductions', () => {
  it('taxes by bracket', () => {
    expect(bracketTax(fed.brackets, 40000).tax).toBeCloseTo(6000);
    expect(bracketTax(fed.brackets, 120000).tax).toBeCloseTo(50000 * 0.15 + 50000 * 0.2 + 20000 * 0.3);
  });

  it('phases out the basic personal amount', () => {
    expect(federalBasicPersonal(fed, 100000)).toBe(15000);
    expect(federalBasicPersonal(fed, 175000)).toBe(14500);
    expect(federalBasicPersonal(fed, 250000)).toBe(14000);
  });

  it('works out CPP, EI and tax for an ordinary pay', () => {
    const d = calculateDeductions({ ...base, gross: 2000 });
    expect(d.cpp).toBeCloseTo((2000 - 3500 / 26) * 0.05, 2);
    expect(d.ei).toBeCloseTo(40, 2);
    expect(d.cpp2).toBe(0);
    expect(d.federalTax).toBeGreaterThan(0);
    expect(d.provincialTax).toBeGreaterThan(0);
    expect(d.employerEi).toBeCloseTo(56, 2);
    expect(d.employerCpp).toBe(d.cpp);
    expect(d.total).toBeCloseTo(d.cpp + d.ei + d.federalTax + d.provincialTax, 2);
  });

  it('stops CPP and EI at the yearly maximums', () => {
    const ytd = { gross: 69900, pensionable: 69900, cpp: (70000 - 3500) * 0.05 - 1, cpp2: 0, insurable: 60000, ei: 60000 * 0.02 };
    const d = calculateDeductions({ ...base, gross: 3000, ytd });
    expect(d.cpp).toBeCloseTo(1, 2);
    expect(d.ei).toBe(0);
    // Earnings past the YMPE start CPP2.
    expect(d.cpp2).toBeCloseTo((72900 - 70000) * 0.04, 2);
  });

  it('respects TD1 claims, exemptions and extra tax', () => {
    const none = calculateDeductions({ ...base, gross: 300, federalClaim: 99999, provincialClaim: 99999, cppExempt: true, eiExempt: true, extraTax: 25 });
    expect(none.cpp + none.ei + none.federalTax + none.provincialTax).toBe(0);
    expect(none.total).toBe(25);
  });

  it('applies a provincial surtax, health premium and low-income reduction', () => {
    const p2: ProvincialTable = { ...prov, surtax: [{ threshold: 1000, rate: 0.2 }], healthPremium: [{ over: 20000, base: 0, rate: 0.06, max: 300 }] };
    const plain = calculateDeductions({ ...base, gross: 3000 });
    const ont = calculateDeductions({ ...base, gross: 3000, provincial: p2 });
    expect(ont.provincialTax).toBeGreaterThan(plain.provincialTax);
    const reduced = calculateDeductions({ ...base, gross: 800, provincial: { ...prov, reduction: { amount: 500, rate: 0.03, threshold: 20000 } } });
    expect(reduced.provincialTax).toBeLessThanOrEqual(calculateDeductions({ ...base, gross: 800 }).provincialTax);
  });

  it('takes pension and union dues off taxable income, and taxes employer-paid benefits', () => {
    const plain = calculateDeductions({ ...base, gross: 2500 });
    const withRpp = calculateDeductions({ ...base, gross: 2500, rpp: 200, unionDues: 30 });
    expect(withRpp.federalTax).toBeLessThan(plain.federalTax);
    expect(withRpp.cpp).toBe(plain.cpp); // CPP and EI aren't reduced by pension or dues
    expect(withRpp.ei).toBe(plain.ei);
    const withBenefit = calculateDeductions({ ...base, gross: 2500, taxableBenefit: 40 });
    expect(withBenefit.federalTax).toBeGreaterThan(plain.federalTax);
    expect(withBenefit.cpp).toBeGreaterThan(plain.cpp);
    expect(withBenefit.ei).toBe(plain.ei);
  });
});

describe('Quebec deductions', () => {
  const qc: QuebecTable = {
    qpp: { rate: 0.06, basicExemption: 3500, ympe: 70000, baseRate: 0.05 },
    qpp2: { rate: 0.04, yampe: 80000 },
    qpip: { employeeRate: 0.005, employerRate: 0.007, maxInsurable: 90000 },
    eiRate: 0.015,
    federalAbatement: 0.165,
    brackets: [{ upTo: 50000, rate: 0.15 }, { upTo: null, rate: 0.2 }],
    basicPersonal: 18000,
    employmentDeduction: { rate: 0.06, max: 1200 },
  };
  const q = { periodsPerYear: 26, ytd: zero, federal: fed, quebec: qc, federalClaim: null, provincialClaim: null, extraTax: 0, cppExempt: false, eiExempt: false };

  it('takes QPP, QPIP, Quebec EI, abated federal tax and Quebec tax', () => {
    const d = calculateQuebecDeductions({ ...q, gross: 2000 });
    expect(d.plan).toBe('QPP');
    expect(d.cpp).toBe(111.92); // (2000 − 3500/26) × 6%
    expect(d.cpp2).toBe(0);
    expect(d.ei).toBe(30); // Quebec rate, not the federal 2%
    expect(d.qpip).toBe(10);
    expect(d.employerQpip).toBe(14);
    expect(d.employerEi).toBe(42);
    // Annual income 26 × (2000 − enhanced QPP): basic federal tax less K1, K2Q (QPP base, EI, QPIP) and K4, then less 16.5%.
    expect(d.federalTax).toBeCloseTo(156.83, 1);
    // Quebec: less the 1,200 employment deduction, credit 15% × 18,000.
    expect(d.provincialTax).toBeCloseTo(187.04, 1);
    expect(d.total).toBe(Math.round((d.cpp + d.ei + d.qpip! + d.federalTax + d.provincialTax) * 100) / 100);
  });

  it('federal tax for a Quebec worker is lower than for the same pay elsewhere (the abatement)', () => {
    const elsewhere = calculateDeductions({ ...base, gross: 2000 });
    expect(calculateQuebecDeductions({ ...q, gross: 2000 }).federalTax).toBeLessThan(elsewhere.federalTax);
  });

  it('stops QPIP at the yearly maximum', () => {
    const d = calculateQuebecDeductions({ ...q, gross: 3000, ytd: { ...zero, gross: 89000, qpipInsurable: 89000, qpip: 445 } });
    expect(d.qpipInsurable).toBe(1000);
    expect(d.qpip).toBe(5);
    expect(d.employerQpip).toBe(7);
  });

  it('QPP exemption stops QPP but not QPIP', () => {
    const d = calculateQuebecDeductions({ ...q, gross: 2000, cppExempt: true });
    expect(d.cpp).toBe(0);
    expect(d.qpip).toBe(10);
  });
});

describe('Ontario tax reduction (T4127 factor S)', () => {
  const on: ProvincialTable = { brackets: [{ upTo: null, rate: 0.05 }], basicPersonal: 10000, ontarioReduction: { basic: 300 } };
  const tax = (gross: number, t: ProvincialTable) => calculateDeductions({ ...base, gross, provincial: t }).provincialTax;
  it('takes the whole tax away when it is small, less as it grows, nothing past twice the basic amount', () => {
    const without = { ...on, ontarioReduction: undefined };
    // Small tax: wiped out entirely.
    expect(tax(500, on)).toBe(0);
    expect(tax(500, without)).toBeGreaterThan(0);
    // Middle: reduced by (2 × 300 − tax), so between zero and the full amount.
    const mid = tax(750, on);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(tax(750, without));
    // High: no reduction.
    expect(tax(3000, on)).toBe(tax(3000, without));
  });
});

describe('Quebec Health Services Fund rate', () => {
  const t = { publicRate: 0.0426, minRate: 0.0165, maxRate: 0.0426, minUpTo: 1_000_000, maxFrom: 7_500_000 };
  it('is the top rate for public bodies, and slides with payroll for others', () => {
    expect(hsfRate(t, 100_000, 'public')).toBe(0.0426);
    expect(hsfRate(t, 800_000, 'private')).toBe(0.0165);
    expect(hsfRate(t, 9_000_000, 'private')).toBe(0.0426);
    expect(hsfRate(t, 4_250_000, 'private')).toBeCloseTo((0.0165 + 0.0426) / 2, 6);
  });
});
