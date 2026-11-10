/**
 * Source deductions for one pay: CPP, CPP2, EI, federal and provincial income tax.
 *
 * Follows the structure of CRA's "Payroll Deductions Formulas" (T4127, option 1:
 * annualize the period's pay, compute the year's tax, divide by the periods).
 * Rates and thresholds are DATA (PayrollTaxTable), one table per year and
 * jurisdiction, and a pay run can't be approved until FH staff have checked
 * every table it uses against that year's T4127. Quebec pays are worked out by
 * calculateQuebecDeductions: QPP instead of CPP, QPIP, EI at the reduced Quebec
 * rate, federal tax less the Quebec abatement, and Quebec tax following the
 * structure of Revenu Québec's TP-1015.F (annualized, like option 1).
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
  /** Low-income reduction (BC, New Brunswick): max(0, amount − rate × (income − threshold)). */
  reduction?: { amount: number; rate: number; threshold: number };
  /** Ontario tax reduction (T4127 factor S): the lesser of the tax and 2 × basic − tax, never below zero. */
  ontarioReduction?: { basic: number };
}

export interface YearToDate {
  gross: number;
  pensionable: number;
  cpp: number;
  cpp2: number;
  insurable: number;
  ei: number;
  /** Quebec only. */
  qpip?: number;
  qpipInsurable?: number;
}

/** Quebec: QPP, QPIP, the reduced EI rate and Quebec income tax (jurisdiction "QC"). */
export interface QuebecTable {
  qpp: { rate: number; basicExemption: number; ympe: number; baseRate: number };
  qpp2: { rate: number; yampe: number };
  qpip: { employeeRate: number; employerRate: number; maxInsurable: number };
  /** EI employee rate for Quebec workers (lower, because QPIP covers parental benefits). */
  eiRate: number;
  /** Federal tax is reduced by this share of basic federal tax (16.5%). */
  federalAbatement: number;
  brackets: Bracket[];
  basicPersonal: number;
  /** Deduction for employment income: rate × annual pay, up to max. */
  employmentDeduction: { rate: number; max: number };
  /** Employer-only contributions (TPZ-1015.R), not withheld from pay. */
  employer?: {
    /** Health Services Fund: public-sector employers pay `publicRate`; others `minRate` up to `minUpTo` of annual payroll, `maxRate` from `maxFrom`, straight-line between. */
    hsf: { publicRate: number; minRate: number; maxRate: number; minUpTo: number; maxFrom: number };
    /** Labour standards (CNT): on each person's pay up to QPIP's maximum insurable earnings. */
    cntRate: number;
    /** Workforce skills development (WSDRF): when annual payroll exceeds `threshold`, less eligible training spending. */
    wsdrf: { rate: number; threshold: number };
  };
}

/** The Health Services Fund rate for an annual Quebec payroll. */
export function hsfRate(t: NonNullable<QuebecTable['employer']>['hsf'], annualPayroll: number, sector: 'public' | 'private'): number {
  if (sector === 'public') return t.publicRate;
  if (annualPayroll <= t.minUpTo) return t.minRate;
  if (annualPayroll >= t.maxFrom) return t.maxRate;
  return t.minRate + ((annualPayroll - t.minUpTo) * (t.maxRate - t.minRate)) / (t.maxFrom - t.minUpTo);
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
  /** Which pension plan the cpp/cpp2 amounts belong to. */
  plan?: 'CPP' | 'QPP';
  /** Quebec only. */
  qpip?: number;
  employerQpip?: number;
  qpipInsurable?: number;
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
  const reduction = pv.reduction
    ? Math.min(T4 + surtax, pos(pv.reduction.amount - pv.reduction.rate * pos(A - pv.reduction.threshold)))
    : pv.ontarioReduction
      ? pos(Math.min(T4 + surtax, 2 * pv.ontarioReduction.basic - (T4 + surtax)))
      : 0;
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

/**
 * Quebec source deductions. Uses the same pay and year-to-date inputs; `provincial`
 * is ignored and `quebec` supplies QPP, QPIP, the Quebec EI rate and Quebec tax.
 * `cpp`/`cpp2` in the result are QPP amounts (plan: 'QPP'); provincialTax is Quebec tax.
 */
export function calculateQuebecDeductions(p: Omit<PayInput, 'provincial'> & { quebec: QuebecTable }): Deductions {
  const P = p.periodsPerYear;
  const f = p.federal;
  const q = p.quebec;
  const gross = pos(p.gross);
  const benefit = pos(p.taxableBenefit ?? 0);
  const rpp = pos(p.rpp ?? 0);
  const dues = pos(p.unionDues ?? 0);
  const earnings = gross + benefit;

  // QPP, on the same pattern as CPP with Quebec's rate.
  const qppMax = r2((q.qpp.ympe - q.qpp.basicExemption) * q.qpp.rate);
  const pensionable = Math.min(earnings, pos(q.qpp.ympe - p.ytd.pensionable));
  const qpp = p.cppExempt ? 0 : r2(Math.min(pos(qppMax - p.ytd.cpp), pos((earnings - q.qpp.basicExemption / P) * q.qpp.rate)));
  const qpp2Max = r2((q.qpp2.yampe - q.qpp.ympe) * q.qpp2.rate);
  const qpp2Base = pos(Math.min(p.ytd.gross + earnings, q.qpp2.yampe) - Math.max(p.ytd.gross, q.qpp.ympe));
  const qpp2 = p.cppExempt ? 0 : r2(Math.min(pos(qpp2Max - p.ytd.cpp2), qpp2Base * q.qpp2.rate));

  // EI at the Quebec rate (cash pay only).
  const insurable = Math.min(gross, pos(f.ei.maxInsurable - p.ytd.insurable));
  const eiMax = r2(f.ei.maxInsurable * q.eiRate);
  const ei = p.eiExempt ? 0 : r2(Math.min(pos(eiMax - p.ytd.ei), insurable * q.eiRate));

  // QPIP: cash pay and taxable benefits, up to the maximum insurable earnings. No exemption by EI status.
  const qpipInsurable = Math.min(earnings, pos(q.qpip.maxInsurable - (p.ytd.qpipInsurable ?? 0)));
  const qpipMax = r2(q.qpip.maxInsurable * q.qpip.employeeRate);
  const qpip = r2(Math.min(pos(qpipMax - (p.ytd.qpip ?? 0)), qpipInsurable * q.qpip.employeeRate));
  const employerQpip = r2(qpipInsurable * q.qpip.employerRate);

  const qppBase = q.qpp.rate ? qpp * (q.qpp.baseRate / q.qpp.rate) : 0;
  const qppEnhanced = qpp - qppBase;
  const annualIncome = pos(P * (earnings - rpp - dues - qppEnhanced - qpp2));

  // Federal: credits include base QPP, EI and QPIP; then the Quebec abatement.
  const baseQppMax = (q.qpp.ympe - q.qpp.basicExemption) * q.qpp.baseRate;
  const fed = bracketTax(f.brackets, annualIncome);
  const fedClaim = p.federalClaim ?? federalBasicPersonal(f, annualIncome);
  const K1 = fed.lowestRate * fedClaim;
  const K2Q = fed.lowestRate * (Math.min(P * qppBase, baseQppMax) + Math.min(P * ei, eiMax) + Math.min(P * qpip, qpipMax));
  const K4 = fed.lowestRate * Math.min(annualIncome, f.cea);
  const basicFederal = pos(fed.tax - K1 - K2Q - K4);
  const T1 = basicFederal - q.federalAbatement * basicFederal;

  // Quebec: income less the deduction for employment income, then the personal amount credit.
  const employmentDeduction = Math.min(q.employmentDeduction.max, q.employmentDeduction.rate * P * earnings);
  const I = pos(annualIncome - employmentDeduction);
  const qc = bracketTax(q.brackets, I);
  const qcTax = pos(qc.tax - qc.lowestRate * (p.provincialClaim ?? q.basicPersonal));

  const federalTax = r2(T1 / P);
  const provincialTax = r2(qcTax / P);
  const extraTax = r2(pos(p.extraTax));
  const total = r2(qpp + qpp2 + ei + qpip + federalTax + provincialTax + extraTax);
  return {
    cpp: qpp,
    cpp2: qpp2,
    ei,
    federalTax,
    provincialTax,
    extraTax,
    total,
    employerCpp: r2(qpp + qpp2),
    employerEi: r2(ei * f.ei.employerMultiplier),
    pensionable: r2(pensionable),
    insurable: r2(insurable),
    plan: 'QPP',
    qpip,
    employerQpip,
    qpipInsurable: r2(qpipInsurable),
  };
}
