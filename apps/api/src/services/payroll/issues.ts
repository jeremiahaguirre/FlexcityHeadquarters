/**
 * Payroll problems and warnings as codes with details, so each screen shows
 * them in the reader's language (the web app translates them). English text
 * is kept here for logs, CSV headers and older API clients.
 */
export interface Issue {
  code: string;
  params?: Record<string, string | number>;
}
export const issue = (code: string, params?: Issue['params']): Issue => (params ? { code, params } : { code });

const EN: Record<string, (p: Record<string, string | number>) => string> = {
  RULES_UNVERIFIED: (p) => `${p.province} rules have not been verified by employment counsel.`,
  STAT_PAY_MANUAL: (p) => `Statutory holiday pay entitlement for ${p.province} is not automated; calculate manually.`,
  NO_EMPLOYEE_NUMBER: (p) => `${p.name}: missing employer employee number.`,
  NO_COST_CENTRE: (p) => `${p.name}: facility has no cost centre.`,
  ADP_COMPANY_CODE: () => 'Enter your three-character ADP company code in the export settings.',
  NO_PAY_CODE: (p) => `${p.name}: no pay code mapped for ${p.code}.`,
  NO_FEDERAL_TABLE: (p) => `There is no federal payroll table for ${p.year}. Ask FH support to add it.`,
  FEDERAL_UNVERIFIED: (p) => `The federal ${p.year} payroll table (CPP, EI, tax) hasn’t been verified against CRA’s T4127 yet.`,
  QUEBEC: (p) => `${p.name} works in Quebec: QPP, QPIP and Revenu Québec withholding aren’t calculated here. Pay Quebec staff through your payroll provider.`,
  QUEBEC_TABLES: (p) => `There is no Quebec payroll table (QPP, QPIP, Quebec tax) for ${p.year}. Ask FH support to add it.`,
  QUEBEC_UNVERIFIED: (p) => `The Quebec ${p.year} payroll table hasn’t been verified against Revenu Québec’s TP-1015.F yet.`,
  NO_PROVINCE_TABLE: (p) => `There is no ${p.province} payroll table for ${p.year}. Ask FH support to add it.`,
  PROVINCE_UNVERIFIED: (p) => `The ${p.province} ${p.year} payroll table hasn’t been verified against CRA’s T4127 yet.`,
  NEGATIVE_NET: (p) => `${p.name}’s deductions are more than their pay. Check their TD1 extra tax.`,
  NO_BANK: (p) => `${p.name} has no verified direct deposit account and will need a cheque.`,
  NO_SIN: (p) => `${p.name} has no SIN on file; it’s needed for their T4.`,
  PUNCHES_PENDING: (p) => `${p.count} punch(es) in or near this period are still pending approval and were excluded.`,
  PUNCHES_OPEN: (p) => `${p.count} punch(es) have no clock-out and were excluded.`,
  STAT_PAY_DATES: (p) => `Statutory holiday pay for ${p.province} (${p.dates}) is not automated; add it manually.`,
  NO_HIRE_DATE: (p) => `${p.name} has no hire date; holiday pay eligibility assumed.`,
  OTHER_DEPARTMENT_HOURS: (p) => `${p.name} also worked in another department this period. Pay this period in one city-wide run, so tax, CPP and EI are worked out once on all their pay.`,
  DEDUCTION_WITHOUT_PAY: (p) => `${p.name} has a one-time deduction but no pay in this run; it was left out. Add it to a run where they're paid.`,
  NO_HOURS: () => 'No approved hours in this period. Approve punches first, then recalculate.',
  LIEU_SHORT: (p) => `${p.name} is taking or being paid more banked time than they have (${p.hours} hours). Check their time-in-lieu days off and payouts.`,
  LIEU_NO_RATE: (p) => `${p.name} has time in lieu to be paid but no hourly rate. Add their pay rate.`,
  LIEU_EXPIRED: (p) => `${p.name} has ${p.hours} hours of banked overtime older than ${p.months} months. Schedule it as time off or pay it out.`,
  LIEU_OWED: (p) => `${p.name} is leaving with ${p.hours} hours of banked overtime. Pay it out on their final pay.`,
};

/** English text for an issue; older pay runs stored plain strings, which pass through. */
export function issueText(i: Issue | string): string {
  if (typeof i === 'string') return i;
  return EN[i.code]?.(i.params ?? {}) ?? i.code;
}

export const ISSUE_CODES = Object.keys(EN);

/** De-duplicates issues by code and details. */
export class IssueSet {
  private readonly map = new Map<string, Issue>();
  constructor(initial: Issue[] = []) {
    for (const i of initial) this.add(i);
  }
  add(i: Issue) {
    this.map.set(JSON.stringify(i), i);
  }
  get size() {
    return this.map.size;
  }
  list(): Issue[] {
    return [...this.map.values()];
  }
}
