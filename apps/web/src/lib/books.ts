export interface PadAgreement { id: string; tenantId: string; status: 'ACTIVE' | 'CANCELLED'; payorName: string; signerName: string; signerTitle: string; institution: string; transit: string; account: string; waivedPreNotice: boolean; channel: 'DEV_CONSOLE' | 'ORGANIZATION'; authorizedAt: string; cancelledAt: string | null; cancelReason: string | null; agreementVersion: string }
export interface Debitable { invoiceId: string; number: string | null; tenantId: string; payor: string; dueDate: string | null; amountCents: number; ready: boolean; reason: string | null }
export interface PadDebit { id: string; invoiceId: string; number: string | null; tenantId: string; payor: string; amountCents: number; status: 'PENDING' | 'SETTLED' | 'RETURNED'; returnReason: string | null; returnedOn: string | null }
export interface PadBatch { id: string; fileNumber: number; debitDate: string; status: 'CREATED' | 'SENT' | 'SETTLED'; totalCents: number; count: number; sentAt: string | null; settledAt: string | null; debits: PadDebit[] }
export interface Originator { originatorId: string; dataCentre: string; shortName: string; longName: string; transactionCode: string; returns: { institution: string; transit: string; account: string }; lastFileNumber: number }

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export interface Account { code: string; name: string; type: AccountType; key: string | null }
export interface BooksSetup { accounts: Account[]; byKey: Record<string, string>; fiscalYearStart: number; closedThrough: string | null; custom: Array<{ code: string; name: string; type: AccountType }> }
export interface JLine { account: string; debitCents: number; creditCents: number }
export interface Entry { date: string; kind: string; reference: string; memo: string; organization: string | null; tenantId: string | null; lines: JLine[] }
