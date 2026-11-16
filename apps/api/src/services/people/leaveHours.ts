/**
 * How many hours of leave a time-off request uses.
 *
 * What counts is the person's own schedule: the hours of their shifts that fall inside the
 * request (a 10-hour shift off is 10 hours, a weekend shift counts, a day they weren't
 * scheduled doesn't). When nothing is scheduled there, it falls back to a working day
 * (8 hours) for each weekday the request spans, or its length if shorter than a day.
 */
import { DateTime } from 'luxon';
import type { Tx } from '../../lib/db.js';

export const HOURS_PER_DAY = 8;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type LeaveBasis = 'SHIFTS' | 'WEEKDAYS';
export interface Interval { startsAt: Date; endsAt: Date }

/** The fallback: 8 hours a weekday, weekends not counted. Each day of the request is the local day (in `timeZone`) its middle falls on. */
export function weekdayLeaveHours(startsAt: Date, endsAt: Date, timeZone: string): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (ms <= 0) return 0;
  if (ms < 86_400_000) return r2(Math.min(HOURS_PER_DAY, ms / 3_600_000));
  // Whole days (rounded, so a daylight-saving change doesn't add or drop one), weekends not counted.
  const first = DateTime.fromJSDate(startsAt, { zone: timeZone });
  let days = 0;
  for (let i = 0; i < Math.round(ms / 86_400_000); i += 1) {
    if (first.plus({ days: i }).plus({ hours: 12 }).weekday <= 5) days += 1; // 1 Monday … 7 Sunday
  }
  return days * HOURS_PER_DAY;
}

/** Hours of `shifts` inside the request; the weekday count when none overlap. */
export function leaveHoursFrom(request: Interval, shifts: Interval[], timeZone: string): { hours: number; basis: LeaveBasis } {
  const from = request.startsAt.getTime();
  const to = request.endsAt.getTime();
  let ms = 0;
  for (const s of shifts) ms += Math.max(0, Math.min(to, s.endsAt.getTime()) - Math.max(from, s.startsAt.getTime()));
  if (ms > 0) return { hours: r2(ms / 3_600_000), basis: 'SHIFTS' };
  return { hours: weekdayLeaveHours(request.startsAt, request.endsAt, timeZone), basis: 'WEEKDAYS' };
}

/**
 * The time zone leave days are counted in: the organization's, i.e. its first facility's
 * (America/Toronto when it has none), as for the reliability policy and other org-wide dates.
 * Time off isn't tied to a facility.
 */
export async function leaveTimeZone(tx: Tx): Promise<string> {
  return (await tx.facility.findFirst({ orderBy: { createdAt: 'asc' }, select: { timezone: true } }))?.timezone ?? 'America/Toronto';
}

/** The person's scheduled shifts overlapping a period (cancelled ones don't count). */
export function scheduledShifts(tx: Tx, userIds: string[], from: Date, to: Date) {
  return tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true } });
}
