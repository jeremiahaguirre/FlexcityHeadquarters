/**
 * Statutory holiday pay (the entitlement for the day itself, separate from the
 * premium for hours worked on it, which payCalc handles).
 */
import { Decimal, ZERO, cents } from '../../lib/money.js';
import { addDays } from '../../lib/time.js';
import type { HolidayPayFormula } from '../compliance/provincialRules.js';

export interface DailyEarnings {
  localDate: string;
  /** Wages earned that day, excluding overtime premiums where the statute says so. */
  wages: Decimal;
  hoursWorked: Decimal;
}

export type HolidayPayResult =
  | { eligible: true; amount: Decimal; basis: string }
  | { eligible: false; amount: Decimal; basis: string };

export function statutoryHolidayPay(
  formula: HolidayPayFormula | null,
  holiday: string,
  hireDate: string,
  history: DailyEarnings[],
): HolidayPayResult | { eligible: null; amount: Decimal; basis: string } {
  if (formula === null) {
    return { eligible: null, amount: ZERO, basis: 'Formula not automated for this province — calculate manually.' };
  }

  switch (formula) {
    case 'BC_30_DAY': {
      const from = addDays(holiday, -30);
      if (hireDate > from) {
        return { eligible: false, amount: ZERO, basis: 'Employed fewer than 30 calendar days before the holiday.' };
      }
      const window = history.filter((d) => d.localDate >= from && d.localDate < holiday && d.hoursWorked.gt(0));
      if (window.length < 15) {
        return { eligible: false, amount: ZERO, basis: `Worked ${window.length} of the 30 days before the holiday (15 required).` };
      }
      const wages = window.reduce((s, d) => s.plus(d.wages), ZERO);
      return { eligible: true, amount: cents(wages.div(window.length)), basis: `Average day's pay over ${window.length} days worked.` };
    }
    case 'FOUR_WEEK_DIV_20':
    case 'FOUR_WEEK_5PCT': {
      const from = addDays(holiday, -28);
      const wages = history
        .filter((d) => d.localDate >= from && d.localDate < holiday)
        .reduce((s, d) => s.plus(d.wages), ZERO);
      const amount = formula === 'FOUR_WEEK_DIV_20' ? wages.div(20) : wages.mul(new Decimal('0.05'));
      return {
        eligible: true,
        amount: cents(amount),
        basis: formula === 'FOUR_WEEK_DIV_20' ? 'Wages in prior 4 weeks ÷ 20.' : '5% of wages in prior 4 weeks.',
      };
    }
  }
}
