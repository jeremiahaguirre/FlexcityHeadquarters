/**
 * How many hours of leave a time-off request uses.
 *
 * What counts is the person's own schedule: the hours of their shifts that fall inside the
 * request (a 10-hour shift off is 10 hours, a weekend shift counts, a day they weren't
 * scheduled doesn't). When nothing is scheduled there, it falls back to a working day
 * (8 hours) for each weekday the request spans, or its length if shorter than a day.
 */
import type { Tx } from '../../lib/db.js';
import { holidaysTouching, organizationDay, statutoryDay } from '../payroll/holidayRules.js';

export const HOURS_PER_DAY = 8;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type LeaveBasis = 'SHIFTS' | 'WEEKDAYS';
export interface Interval { startsAt: Date; endsAt: Date }

/** The fallback: 8 hours a weekday, weekends not counted. */
export function weekdayLeaveHours(startsAt: Date, endsAt: Date): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (ms <= 0) return 0;
  if (ms < 86_400_000) return r2(Math.min(HOURS_PER_DAY, ms / 3_600_000));
  // Whole days (rounded, so a daylight-saving change doesn't add or drop one), weekends not counted.
  let days = 0;
  for (let i = 0; i < Math.round(ms / 86_400_000); i += 1) {
    const dow = new Date(startsAt.getTime() + i * 86_400_000 + 43_200_000).getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days * HOURS_PER_DAY;
}

/** Hours of `shifts` inside the request; the weekday count when none overlap. */
export function leaveHoursFrom(request: Interval, shifts: Interval[]): { hours: number; basis: LeaveBasis } {
  const from = request.startsAt.getTime();
  const to = request.endsAt.getTime();
  let ms = 0;
  for (const s of shifts) ms += Math.max(0, Math.min(to, s.endsAt.getTime()) - Math.max(from, s.startsAt.getTime()));
  if (ms > 0) return { hours: r2(ms / 3_600_000), basis: 'SHIFTS' };
  return { hours: weekdayLeaveHours(request.startsAt, request.endsAt), basis: 'WEEKDAYS' };
}

/** How many of the weekday-fallback days of a request are holidays (`daysOff`, YYYY-MM-DD), counted the same way as weekdayLeaveHours. */
export function holidayWeekdays(startsAt: Date, endsAt: Date, daysOff: ReadonlySet<string>): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (ms <= 0 || !daysOff.size) return 0;
  let n = 0;
  for (let i = 0; i < Math.max(1, Math.round(ms / 86_400_000)); i += 1) {
    const at = new Date(startsAt.getTime() + i * 86_400_000 + (ms < 86_400_000 ? 0 : 43_200_000));
    const dow = at.getUTCDay();
    if (dow !== 0 && dow !== 6 && daysOff.has(at.toISOString().slice(0, 10))) n += 1;
  }
  return n;
}

/**
 * leaveHoursFrom, without the holidays the organization is closed for: when nothing is scheduled,
 * a statutory holiday, a city-added holiday or a closure day inside the request isn't charged.
 * (Scheduled shifts are charged as they are: someone scheduled on a holiday who takes it off uses leave.)
 */
export function leaveHoursOff(request: Interval, shifts: Interval[], daysOff: ReadonlySet<string>): { hours: number; basis: LeaveBasis } {
  const r = leaveHoursFrom(request, shifts);
  if (r.basis !== 'WEEKDAYS' || !daysOff.size) return r;
  const off = holidayWeekdays(request.startsAt, request.endsAt, daysOff);
  if (!off) return r;
  const ms = request.endsAt.getTime() - request.startsAt.getTime();
  return { hours: ms < 86_400_000 ? 0 : Math.max(0, r.hours - off * HOURS_PER_DAY), basis: r.basis };
}

/**
 * The organization's days off for holidays in a period, for leave: the statutory day and the day
 * the organization observes it, and city-added holidays and closure days (TenantHoliday). With
 * facilities in more than one province, only days that are holidays in all of them.
 */
export async function leaveDaysOff(tx: Tx, from: Date, to: Date): Promise<Set<string>> {
  const [t, facilities] = await Promise.all([tx.tenant.findFirst({ select: { holidayObservance: true } }), tx.facility.findMany({ select: { province: true } })]);
  const provinces = [...new Set(facilities.map((f) => f.province))];
  if (!t || !provinces.length) return new Set();
  const a = new Date(from.getTime() - 86_400_000).toISOString().slice(0, 10);
  const b = new Date(to.getTime() + 86_400_000).toISOString().slice(0, 10);
  const sets = await Promise.all(provinces.map(async (p) => new Set((await holidaysTouching(tx, p, a, b)).flatMap((h) => [statutoryDay(h), organizationDay(h, t.holidayObservance)]))));
  return new Set([...sets[0]!].filter((d) => sets.every((s) => s.has(d))));
}

/** The person's scheduled shifts overlapping a period (cancelled ones don't count). */
export function scheduledShifts(tx: Tx, userIds: string[], from: Date, to: Date) {
  return tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true } });
}
