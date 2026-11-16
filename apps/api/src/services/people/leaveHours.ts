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

/**
 * The fallback: 8 hours a weekday, weekends not counted, in the local calendar of `timeZone`.
 * A request shorter than a local day counts its length (at most 8). Longer ones count whole local
 * days (rounded), each the local day its middle (12 hours in) falls on, so a day entered at another
 * zone's midnight is still that day.
 */
export function weekdayLeaveHours(startsAt: Date, endsAt: Date, timeZone: string): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (ms <= 0) return 0;
  const first = DateTime.fromJSDate(startsAt, { zone: timeZone });
  // Calendar days, so a full day across a clock change (23 or 25 hours) is one day.
  const length = DateTime.fromJSDate(endsAt, { zone: timeZone }).diff(first, 'days').days;
  if (length < 1) return r2(Math.min(HOURS_PER_DAY, ms / 3_600_000));
  let days = 0;
  for (let i = 0; i < Math.round(length); i += 1) {
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

const LOOKBACK_MS = 90 * 86_400_000;

/**
 * The time zone each person's leave is counted in, the way payroll counts their days
 * (payrollRun.ts): their main facility's, the one where they worked the most hours (approved
 * punches) in the 90 days before `at`. With no hours there, the organization's (orgTimeZone).
 * One query for everyone.
 */
export async function leaveTimeZones(tx: Tx, userIds: string[], at: Date): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const rows = ids.length
    ? await tx.$queryRaw<Array<{ userId: string; timezone: string }>>`
        SELECT DISTINCT ON (p."userId") p."userId"::text AS "userId", f.timezone
        FROM "TimePunch" p JOIN "Facility" f ON f.id = p."facilityId"
        WHERE p."userId" = ANY(${ids}::uuid[]) AND p.status = 'APPROVED' AND p."clockOut" IS NOT NULL
          AND p."clockOut" > ${new Date(at.getTime() - LOOKBACK_MS)} AND p."clockIn" < ${at}
        GROUP BY p."userId", f.id
        ORDER BY p."userId", sum(p."clockOut" - p."clockIn") DESC, f.id`
    : [];
  const out = new Map(rows.map((r) => [r.userId, r.timezone]));
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const org = await orgTimeZone(tx);
    for (const id of missing) out.set(id, org);
  }
  return out;
}

/** One person's zone for a request: by their hours before it starts (or before now, for one ahead). */
export async function personLeaveTimeZone(tx: Tx, userId: string, startsAt: Date, now = new Date()): Promise<string> {
  return (await leaveTimeZones(tx, [userId], new Date(Math.min(startsAt.getTime(), now.getTime())))).get(userId)!;
}

/**
 * The organization's time zone: its first facility's, the oldest by when it was added (then by id),
 * as for the reliability policy and release and maintenance notices. Renaming or adding a facility
 * doesn't change it. America/Toronto when there is none.
 */
export async function orgTimeZone(tx: Tx): Promise<string> {
  return (await tx.facility.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { timezone: true } }))?.timezone ?? 'America/Toronto';
}

/**
 * Read-only, for payroll to review: approved requests charged by weekdays whose count differs
 * from the current rule (hours charged before weekdays were counted in local time). Each is
 * recounted in the person's zone as of when it was decided. Nothing is changed here.
 */
export async function weekdayRecount(tx: Tx) {
  const reqs = await tx.timeOffRequest.findMany({
    where: { status: 'APPROVED', chargedBasis: 'WEEKDAYS', chargedHours: { not: null } },
    select: { id: true, userId: true, type: true, startsAt: true, endsAt: true, chargedHours: true, decidedAt: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const out = [];
  for (const r of reqs) {
    const timeZone = await personLeaveTimeZone(tx, r.userId, r.startsAt, r.decidedAt ?? new Date());
    const recount = weekdayLeaveHours(r.startsAt, r.endsAt, timeZone);
    const charged = Number(r.chargedHours);
    if (Math.abs(recount - charged) > 0.001) out.push({ id: r.id, userId: r.userId, type: r.type, startsAt: r.startsAt, endsAt: r.endsAt, charged, recount, timeZone });
  }
  return out;
}

/** The person's scheduled shifts overlapping a period (cancelled ones don't count). */
export function scheduledShifts(tx: Tx, userIds: string[], from: Date, to: Date) {
  return tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true } });
}
