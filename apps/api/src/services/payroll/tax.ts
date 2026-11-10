/**
 * Source deductions for one pay: CPP, CPP2, EI, federal and provincial income tax.
 *
 * Follows the structure of CRA's "Payroll Deductions Formulas" (T4127, option 1:
 * annualize the period's pay, compute the year's tax, divide by the periods).
 * Rates and thresholds are DATA (PayrollTaxTable), one table per year and
 * jurisdiction, and a pay run can't be approved until FH staff have checked
 * every table it uses against that year's T4127. Quebec (QPP, QPIP, Revenu
 * Québec) is not calculated here.
 */

export interface Bracket {
  /** Upper end of the bracket in annual taxable income; null = no limit. */
  upTo: number | null;
  rate: number;
}

export interface FederalTable {
  cpp: { rate: number; basicExemption: number; ympe: number; baseRate: number };
  cpp2: { rate: number; yampe: number };
  ei: { rate: number; maxInsurable: number; employerMultiplier: number };
  brackets: Bracket[];
  /** Basic personal amount: `max` below `phaseOutFrom`, falling to `min` at `phaseOutTo`. */
  basicPersonal: { max: number; min: number; phaseOutFrom: number; phaseOutTo: number };
  /** Canada employment amount. */
  cea: number;
}

export interface ProvincialTable {
  brackets: Bracket[];
  basicPersonal: number;
  /** Ontario surtax: rate × (basic provincial tax − threshold), for each tier. */
  surtax?: Array<{ threshold: number; rate: number }>;
  /** Ontario Health Premium by annual taxable income: base + rate × (income − over), capped at max. */
  healthPremium?: Array<{ over: number; base: number; rate: number; max: number }>;
  /** Low-income reduction (BC, Ontario): max(0, amount − rate × (income − threshold)). */
  reduction?: { amount: number; rate: number; threshold: number };
}

export interface YearToDate {
  gross: number;
  pensionable: number;
  cpp: number;
  cpp2: number;
  insurable: number;
  ei: number;
}

export interface PayInput {
  /** Taxable, pensionable and insurable earnings this period (gross, vacation pay included). */
  gross: number;
  periodsPerYear: number;
  ytd: YearToDate;
  federal: FederalTable;
  provincial: ProvincialTable;
  /** TD1 claim amounts; null = the basic personal amount. */
  federalClaim: number | null;
  provincialClaim: number | null;
  extraTax: number;
  cppExempt: boolean;
  eiExempt: boolean;
  /** Registered pension plan contributions this pay: deducted from income before tax. */
  rpp?: number;
  /** Union dues this pay: deducted from income before tax. */
  unionDues?: number;
  /** Employer-paid taxable benefits this pay (e.g. group life): taxed and pensionable, not insurable, not paid in cash. */
  taxableBenefit?: number;
}

export interface Deductions {
  cpp: number;
  cpp2: number;
  ei: number;
  federalTax: number;
  provincialTax: number;
  extraTax: number;
  total: number;
  employerCpp: number;
  employerEi: number;
  pensionable: number;
  insurable: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pos = (n: number) => (n > 0 ? n : 0);

/** Tax on annual income A by brackets (rate × A − K form, with K built from the brackets). */
export function bracketTax(brackets: Bracket[], income: number): { tax: number; lowestRate: number } {
  let tax = 0;
  let from = 0;
  for (const b of brackets) {
    const top = b.upTo ?? Infinity;
    if (income > from) tax += (Math.min(income, top) - from) * b.rate;
    from = top;
    if (income <= top) break;
  }
  return { tax, lowestRate: brackets[0]?.rate ?? 0 };
}

export function federalBasicPersonal(t: FederalTable, income: number): number {
  const b = t.basicPersonal;
  if (income <= b.phaseOutFrom) return b.max;
  if (income >= b.phaseOutTo) return b.min;
  return b.max - ((income - b.phaseOutFrom) * (b.max - b.min)) / (b.phaseOutTo - b.phaseOutFrom);
}

export function calculateDeductions(p: PayInput): Deductions {
  const P = p.periodsPerYear;
  const f = p.federal;
  const gross = pos(p.gross);
  const benefit = pos(p.taxableBenefit ?? 0);
  const rpp = pos(p.rpp ?? 0);
  const dues = pos(p.unionDues ?? 0);
  // CPP is on cash pay plus taxable benefits; EI only on cash pay.
  const cppEarnings = gross + benefit;

  // CPP: contributions on pensionable earnings above the prorated basic exemption, up to the YMPE.
  const cppMax = r2((f.cpp.ympe - f.cpp.basicExemption) * f.cpp.rate);
  const pensionableRoom = pos(f.cpp.ympe - p.ytd.pensionable);
  const pensionable = Math.min(cppEarnings, pensionableRoom);
  // The rate applies to the period's full pay; the yearly maximum does the capping.
  const cpp = p.cppExempt ? 0 : r2(Math.min(pos(cppMax - p.ytd.cpp), pos((cppEarnings - f.cpp.basicExemption / P) * f.cpp.rate)));
  // CPP2: on earnings between the YMPE and the YAMPE.
  const cpp2Max = r2((f.cpp2.yampe - f.cpp.ympe) * f.cpp2.rate);
  const totalAfter = p.ytd.gross + cppEarnings;
  const cpp2Base = pos(Math.min(totalAfter, f.cpp2.yampe) - Math.max(p.ytd.gross, f.cpp.ympe));
  const cpp2 = p.cppExempt ? 0 : r2(Math.min(pos(cpp2Max - p.ytd.cpp2), cpp2Base * f.cpp2.rate));
  // EI: premiums on insurable earnings up to the yearly maximum.
  const insurable = Math.min(gross, pos(f.ei.maxInsurable - p.ytd.insurable));
  const eiMax = r2(f.ei.maxInsurable * f.ei.rate);
  const ei = p.eiExempt ? 0 : r2(Math.min(pos(eiMax - p.ytd.ei), insurable * f.ei.rate));

  // The enhanced part of CPP and all of CPP2 are deducted from income; the base part is a credit.
  const cppBase = f.cpp.rate ? cpp * (f.cpp.baseRate / f.cpp.rate) : 0;
  const cppEnhanced = cpp - cppBase;
  const A = pos(P * (gross + benefit - rpp - dues - cppEnhanced - cpp2));

  // Credits at the lowest rate: personal amount, base CPP and EI (annualized, capped), employment amount.
  const baseCppMax = (f.cpp.ympe - f.cpp.basicExemption) * f.cpp.baseRate;
  const annualCppBase = Math.min(P * cppBase, baseCppMax);
  const annualEi = Math.min(P * ei, eiMax);

  const fed = bracketTax(f.brackets, A);
  const fedClaim = p.federalClaim ?? federalBasicPersonal(f, A);
  const K1 = fed.lowestRate * fedClaim;
  const K2 = fed.lowestRate * (annualCppBase + annualEi);
  const K4 = fed.lowestRate * Math.min(A, f.cea);
  const T1 = pos(fed.tax - K1 - K2 - K4);

  const pv = p.provincial;
  const prov = bracketTax(pv.brackets, A);
  const provClaim = p.provincialClaim ?? pv.basicPersonal;
  const T4 = pos(prov.tax - prov.lowestRate * provClaim - prov.lowestRate * (annualCppBase + annualEi));
  const surtax = (pv.surtax ?? []).reduce((s, t) => s + t.rate * pos(T4 - t.threshold), 0);
  let premium = 0;
  for (const h of pv.healthPremium ?? []) if (A > h.over) premium = Math.min(h.max, h.base + h.rate * (A - h.over));
  const reduction = pv.reduction ? Math.min(T4 + surtax, pos(pv.reduction.amount - pv.reduction.rate * pos(A - pv.reduction.threshold))) : 0;
  const T2 = pos(T4 + surtax - reduction) + premium;

  const federalTax = r2(T1 / P);
  const provincialTax = r2(T2 / P);
  const extraTax = r2(pos(p.extraTax));
  const total = r2(cpp + cpp2 + ei + federalTax + provincialTax + extraTax);
  return {
    cpp,
    cpp2,
    ei,
    federalTax,
    provincialTax,
    extraTax,
    total,
    employerCpp: r2(cpp + cpp2),
    employerEi: r2(ei * f.ei.employerMultiplier),
    pensionable: r2(pensionable),
    insurable: r2(insurable),
  };
}
