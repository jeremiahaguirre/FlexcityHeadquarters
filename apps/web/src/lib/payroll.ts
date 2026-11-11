import type { Issue } from './payrollIssues';
/** Payroll shapes as the API sends them (pay statements, deductions, runs), shared by the pay screens. */
export interface Earning { code: string; positionId: string | null; hours: number; rate: number; amount: number }
export interface BenefitLine { planId: string; name: string; nameFr: string | null; kind: string; employee: number; employer: number; taxable: number }
export interface Deductions { cpp: number; cpp2: number; ei: number; federalTax: number; provincialTax: number; extraTax: number; total: number; employerCpp?: number; employerEi?: number; benefits?: BenefitLine[]; rpp?: number; unionDues?: number; afterTax?: number; taxableBenefit?: number; employerBenefits?: number; plan?: 'CPP' | 'QPP'; qpip?: number; employerQpip?: number; qpipInsurable?: number }
export interface Ytd { gross: number; cpp: number; cpp2: number; ei: number; federalTax: number; provincialTax: number; net: number; qpip?: number }
export interface Statement {
  id: string;
  payDate: string;
  year: number;
  province: string;
  hours: number;
  earnings: Earning[];
  deductions: Deductions;
  gross: number;
  totalDeductions: number;
  net: number;
  ytd: Ytd;
  deposit: string | null;
  periodStart?: string;
  periodEnd?: string;
  employee?: { name: string; employeeNumber: string | null };
  employer?: { name: string; address: string | null };
  positions?: Array<{ id: string; name: string; nameFr: string | null }>;
  status?: string;
}
export interface BankAccount { id: string; holderName: string; institution: string; transit: string; account: string; status: 'PENDING' | 'ACTIVE'; createdAt: string; verifiedAt: string | null; enteredById: string }
export interface PayProfile { mailingAddress?: { line1: string; line2?: string | null; city: string; province: string; postalCode: string } | null; province: string | null; federalClaim: number | null; provincialClaim: number | null; extraTaxPerPeriod: number; cppExempt: boolean; eiExempt: boolean; sin: string | null; td1SignedAt: string | null }
export interface MyPay { statements: Statement[]; profile: PayProfile; bankAccounts: BankAccount[]; consent: string }
export interface Run {
  kind?: 'REGULAR' | 'OFF_CYCLE';
  note?: string | null;
  id: string;
  departmentId: string | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID';
  totals: { gross?: number; deductions?: number; net?: number; employerCpp?: number; employerEi?: number; employerQpip?: number; people?: number; deposits?: number; cheques?: number };
  blockers: Array<Issue | string>;
  warnings: Array<Issue | string>;
  preparedById: string;
  approvedById: string | null;
  fileCreationNumber: number | null;
  depositFileSha256: string | null;
}
export const STATUS_TONE = { DRAFT: 'pending', APPROVED: 'brand', PAID: 'ok', VOID: 'danger' } as const;
