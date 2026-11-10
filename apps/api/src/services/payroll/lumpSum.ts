/**
 * One-time payments (bonuses, retroactive pay, a vacation payout) are taxed with CRA's bonus method
 * (T4127, "bonuses, retroactive pay increases"), not as if every pay were that large:
 *
 *   tax on the lump sum = annual tax on (regular pay × periods + lump sum) − annual tax on (regular pay × periods)
 *
 * Done with the period calculation: P × (tax(G + B / P) − tax(G)), where G is the period's regular
 * pay (or, on an off-cycle run, the person's last regular pay as the estimate) and B the lump sum.
 * CPP/QPP, EI and QPIP are worked out on the whole amount paid, as usual, against the year's maximums.
 */
import type { Deductions } from './tax.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function withBonusMethod(calc: (gross: number) => Deductions, regular: number, lump: number, periodsPerYear: number, regularEstimate = regular): Deductions {
  const all = calc(regular + lump);
  if (lump <= 0) return all;
  const G = regular > 0 ? regular : regularEstimate;
  const base = calc(G);
  const spread = calc(G + lump / periodsPerYear);
  const lumpFed = Math.max(0, periodsPerYear * (spread.federalTax - base.federalTax));
  const lumpProv = Math.max(0, periodsPerYear * (spread.provincialTax - base.provincialTax));
  // On an off-cycle run there's no regular pay in it: only the lump sum's own tax.
  const regFed = regular > 0 ? calc(regular).federalTax : 0;
  const regProv = regular > 0 ? calc(regular).provincialTax : 0;
  const federalTax = r2(regFed + lumpFed);
  const provincialTax = r2(regProv + lumpProv);
  const total = r2(all.cpp + all.cpp2 + all.ei + (all.qpip ?? 0) + federalTax + provincialTax + all.extraTax);
  return { ...all, federalTax, provincialTax, total };
}
