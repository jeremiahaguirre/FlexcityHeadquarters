export interface TaxLine { name: string; rate: string; amountCents: number }
export interface InvoiceRow {
  id: string;
  tenantId: string;
  organization: { name: string; subdomain: string } | null;
  number: string | null;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'OVERDUE' | 'PAID' | 'VOID';
  periodStart: string;
  periodEnd: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotalCents: number;
  taxLines: TaxLine[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  billTo: { legalName: string; contactName: string | null; email: string; address: string[]; province: string; taxExempt: boolean; taxExemptNote: string | null };
  poNumber: string | null;
  notes: string | null;
  voidReason: string | null;
  lines: Array<{ id: string; description: string; quantity: number; unitCents: number; amountCents: number }>;
  payments: Array<{ id: string; amountCents: number; receivedOn: string; method: string; reference: string | null }>;
}
export const STATUS_TONE = { DRAFT: 'pending', SENT: 'pending', PARTIAL: 'new', OVERDUE: 'danger', PAID: 'ok', VOID: 'inactive' } as const;
export const cad = (cents: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const recentMonths = (n = 6) => {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
};
