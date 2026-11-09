/**
 * Canadian sales tax on FH's subscriptions, by the customer's province
 * (place of supply for services and intangibles follows the recipient).
 *
 * VERIFY WITH AN ACCOUNTANT before invoicing: provincial sales tax on SaaS
 * (BC PST, SK PST, MB RST) and exemptions for public bodies are judgement calls,
 * and rates change. Municipalities pay GST/HST and claim their public service
 * body rebate themselves; FH still charges it.
 */
export interface TaxComponent { name: string; rate: string }

export const TAX_RATES_VERIFIED = false;
export const TAX_RATES_AS_OF = '2026-11-01';

const GST: TaxComponent = { name: 'GST', rate: '5' };
const HST = (rate: string): TaxComponent => ({ name: 'HST', rate });

export const SALES_TAX: Record<string, TaxComponent[]> = {
  AB: [GST],
  BC: [GST, { name: 'PST', rate: '7' }],
  SK: [GST, { name: 'PST', rate: '6' }],
  MB: [GST, { name: 'RST', rate: '7' }],
  ON: [HST('13')],
  QC: [GST, { name: 'QST', rate: '9.975' }],
  NB: [HST('15')],
  NS: [HST('14')], // reduced from 15% on 2025-04-01
  PE: [HST('15')],
  NL: [HST('15')],
  YT: [GST],
  NT: [GST],
  NU: [GST],
};

/** Rate as a string so 9.975% stays exact; amounts are whole cents, rounded half-up per tax. */
export function taxFor(province: string, subtotalCents: number, exempt: boolean): Array<TaxComponent & { amountCents: number }> {
  if (exempt) return [];
  const parts = SALES_TAX[province];
  if (!parts) throw new Error(`Unknown province ${province}`);
  return parts.map((p) => {
    // rate has at most 3 decimals: work in thousandths of a percent to stay in integers.
    const milli = Math.round(Number(p.rate) * 1000);
    return { ...p, amountCents: Math.floor((subtotalCents * milli + 50_000) / 100_000) };
  });
}
