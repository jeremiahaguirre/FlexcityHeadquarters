/**
 * Money and hours are computed with arbitrary-precision decimals and rounded
 * only when a line is emitted. Never use JS floats for pay.
 */
import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalLike = Decimal | string | number | { toString(): string };

export function dec(v: DecimalLike): Decimal {
  return v instanceof Decimal ? v : new Decimal(v.toString());
}

export const ZERO = new Decimal(0);

export function cents(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Exact hours between two instants, as a Decimal. */
export function hoursDec(start: Date, end: Date): Decimal {
  return new Decimal(end.getTime() - start.getTime()).div(3_600_000);
}
