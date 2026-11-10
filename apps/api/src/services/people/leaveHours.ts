/**
 * How many hours of leave a time-off request uses.
 *
 * What counts is the person's own schedule: the hours of their shifts that fall inside the
 * request (a 10-hour shift off is 10 hours, a weekend shift counts, a day they weren't
 * scheduled doesn't). When nothing is scheduled there, it falls back to a working day
 * (8 hours) for each weekday the request spans, or its length if shorter than a day.
 */
import type { Tx } from '../../lib/db.js';

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

/** The person's scheduled shifts overlapping a period (cancelled ones don't count). */
export function scheduledShifts(tx: Tx, userIds: string[], from: Date, to: Date) {
  return tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true } });
}
