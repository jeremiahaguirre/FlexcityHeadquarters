/**
 * Pay preview for an open shift: what it would add to this person's pay, with
 * the same engine as payroll. Runs the pay period with and without the shift
 * and reports the difference, so overtime, statutory-holiday and premium
 * rules are exactly the ones payroll will apply. An estimate: deductions are
 * not included and the period may still change.
 */
import type { Tx } from '../../lib/db.js';
import { Decimal, dec } from '../../lib/money.js';
import { addDays, localDate, payWeekStart, startOfLocalDay } from '../../lib/time.js';
import { loadShiftBundle } from '../scheduling/eligibilityLoader.js';
import { calculatePay } from './payCalc.js';

export async function previewShiftPay(tx: Tx, userId: string, shiftId: string) {
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) return null;
  const { shift } = bundle;
  const tz = shift.timezone;
  const periodStart = payWeekStart(localDate(shift.start, tz), bundle.payWeekStartDay);
  const from = startOfLocalDay(periodStart, tz);
  const to = startOfLocalDay(addDays(periodStart, 7), tz);
  const [rates, mine, holidays, premium] = await Promise.all([
    tx.payRate.findMany({ where: { userId } }),
    tx.shift.findMany({ where: { userId, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from }, id: { not: shiftId } }, select: { startsAt: true, endsAt: true, positionId: true, premiumPerHour: true } }),
    tx.statutoryHoliday.findMany({ where: { province: bundle.province, date: { gte: new Date(periodStart), lt: new Date(addDays(periodStart, 7)) } } }),
    tx.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { premiumPerHour: true } }),
  ]);
  const rateOn = (positionId: string, day: string) =>
    rates
      .filter((r) => r.positionId === positionId && r.effectiveFrom.toISOString().slice(0, 10) <= day && (!r.effectiveTo || r.effectiveTo.toISOString().slice(0, 10) >= day))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  const day = localDate(shift.start, tz);
  const own = rateOn(shift.positionId, day);
  if (!own) return { available: false as const };
  const rateFor = (positionId: string, d: string) => {
    const r = rateOn(positionId, d);
    return r ? dec(r.hourlyRate) : dec(own.hourlyRate);
  };
  const run = (intervals: Array<{ start: Date; end: Date; positionId: string; premiumPerHour: Decimal | null }>) =>
    calculatePay({ intervals, timezone: tz, payWeekStartDay: bundle.payWeekStartDay, periodStart, weeks: 1, rules: { ...bundle.rules, verified: true }, rateFor, statHolidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))), completedYearsOfService: 0, vacationPayMode: 'ACCRUE' });
  const existing = mine.map((s) => ({ start: s.startsAt, end: s.endsAt, positionId: s.positionId, premiumPerHour: s.premiumPerHour ? dec(s.premiumPerHour) : null }));
  const before = run(existing);
  const after = run([...existing, { start: shift.start, end: shift.end, positionId: shift.positionId, premiumPerHour: premium.premiumPerHour ? dec(premium.premiumPerHour) : null }]);
  const hoursOf = (r: ReturnType<typeof run>, codes: string[]) => r.lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s.plus(l.hours), new Decimal(0));
  const diff = (codes: string[]) => Decimal.max(hoursOf(after, codes).minus(hoursOf(before, codes)), 0);
  return {
    available: true as const,
    hours: ((shift.end.getTime() - shift.start.getTime()) / 3_600_000).toFixed(2),
    rate: dec(own.hourlyRate).toFixed(2),
    gross: after.grossWages.minus(before.grossWages).toFixed(2),
    overtimeHours: diff(['OVERTIME_1_5', 'OVERTIME_2_0']).toFixed(2),
    statHoliday: holidays.some((h) => h.date.toISOString().slice(0, 10) === day),
    premiumPerHour: premium.premiumPerHour ? dec(premium.premiumPerHour).toFixed(2) : null,
  };
}
