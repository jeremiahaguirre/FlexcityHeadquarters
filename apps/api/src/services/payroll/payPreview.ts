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
import { holidaysTouching, premiumDays, usuallyWorks } from './holidayRules.js';
import { calculatePay } from './payCalc.js';
import { breakMinutesOf, paidHours, premiumPieces, reportingMinimum } from '../scheduling/workRules.js';

export async function previewShiftPay(tx: Tx, userId: string, shiftId: string) {
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) return null;
  const { shift } = bundle;
  const tz = shift.timezone;
  const periodStart = payWeekStart(localDate(shift.start, tz), bundle.payWeekStartDay);
  const from = startOfLocalDay(periodStart, tz);
  const to = startOfLocalDay(addDays(periodStart, 7), tz);
  const [rates, mine, past, holidays, premium] = await Promise.all([
    tx.payRate.findMany({ where: { userId } }),
    tx.shift.findMany({ where: { userId, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from }, id: { not: shiftId } }, select: { startsAt: true, endsAt: true, positionId: true, premiumPerHour: true, unpaidBreakMinutes: true, position: { select: { unpaidBreakMinutes: true, departmentId: true } } } }),
    // Their shifts in the 10 weeks before, for whether a holiday is a day they usually work.
    tx.shift.findMany({ where: { userId, status: { not: 'CANCELLED' }, startsAt: { gte: startOfLocalDay(addDays(periodStart, -70), tz), lt: from } }, select: { startsAt: true } }),
    holidaysTouching(tx, bundle.province, periodStart, addDays(periodStart, 7)),
    tx.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { premiumPerHour: true, facility: { select: { tenant: { select: { holidayObservance: true } } } } } }),
  ]);
  const worked = new Set(past.map((s) => localDate(s.startsAt, tz)));
  const statDays = premiumDays(holidays, premium.facility.tenant.holidayObservance, (d) => usuallyWorks(worked, d));
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
  // Rule-based premiums (evening, night, weekend, holiday) of this shift's department, as payroll applies them.
  const deptOf = new Map(mine.map((s) => [s.positionId, s.position.departmentId]));
  deptOf.set(shift.positionId, bundle.departmentId);
  const rulePremiums = bundle.workRules.premiums.length
    ? (piece: { start: Date; end: Date; positionId: string }) => premiumPieces(piece, bundle.workRules.premiums, { timezone: tz, departmentId: deptOf.get(piece.positionId) ?? null, positionId: piece.positionId, holidays: statDays })
    : undefined;
  const run = (intervals: Array<{ start: Date; end: Date; positionId: string; premiumPerHour: Decimal | null; breakMinutes?: number | null; breakAfterHours?: number | null }>) =>
    calculatePay({ intervals, timezone: tz, payWeekStartDay: bundle.payWeekStartDay, periodStart, weeks: 1, rules: { ...bundle.rules, verified: true }, rateFor, statHolidays: statDays, completedYearsOfService: 0, vacationPayMode: 'ACCRUE', rulePremiums });
  const existing = mine.map((s) => ({ start: s.startsAt, end: s.endsAt, positionId: s.positionId, premiumPerHour: s.premiumPerHour ? dec(s.premiumPerHour) : null, breakMinutes: breakMinutesOf(s, s.position) }));
  const before = run(existing);
  const after = run([...existing, { start: shift.start, end: shift.end, positionId: shift.positionId, premiumPerHour: premium.premiumPerHour ? dec(premium.premiumPerHour) : null, breakMinutes: shift.breakMinutes, breakAfterHours: shift.breakAfterHours }]);
  const paid = paidHours(shift);
  // A shift shorter than the call-in minimum is paid the minimum when worked.
  const minimum = bundle.callBack ? null : reportingMinimum(bundle.workRules.callIn, bundle.rules.reportingPay, paid);
  const topUp = minimum && paid < minimum.minHours ? dec(own.hourlyRate).mul(minimum.minHours - paid) : new Decimal(0);
  const hoursOf = (r: ReturnType<typeof run>, codes: string[]) => r.lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s.plus(l.hours), new Decimal(0));
  const diff = (codes: string[]) => Decimal.max(hoursOf(after, codes).minus(hoursOf(before, codes)), 0);
  return {
    available: true as const,
    hours: paid.toFixed(2),
    unpaidBreakMinutes: shift.breakMinutes ?? 0,
    rate: dec(own.hourlyRate).toFixed(2),
    gross: after.grossWages.minus(before.grossWages).plus(topUp).toFixed(2),
    minimumHours: minimum && paid < minimum.minHours ? minimum.minHours : null,
    rulePremium: after.lines.filter((l) => l.code === 'SHIFT_PREMIUM').reduce((s, l) => s.plus(l.amount), new Decimal(0)).minus(before.lines.filter((l) => l.code === 'SHIFT_PREMIUM').reduce((s, l) => s.plus(l.amount), new Decimal(0))).toFixed(2),
    overtimeHours: diff(['OVERTIME_1_5', 'OVERTIME_2_0']).toFixed(2),
    statHoliday: statDays.has(day),
    premiumPerHour: premium.premiumPerHour ? dec(premium.premiumPerHour).toFixed(2) : null,
  };
}
