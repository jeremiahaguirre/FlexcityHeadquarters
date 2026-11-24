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

/**
 * For leave charged from shifts (leaveHoursFrom's SHIFTS basis): the hours on each local day, by
 * the day each shift's part inside the request starts on. Hundredths, adding up to the hours charged.
 */
export function shiftLeaveDays(request: Interval, shifts: Interval[], timeZone: string): Array<{ day: string; hours: number }> {
  const from = request.startsAt.getTime();
  const to = request.endsAt.getTime();
  const byDay = new Map<string, number>();
  let ms = 0;
  for (const s of [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const start = Math.max(from, s.startsAt.getTime());
    const part = Math.max(0, Math.min(to, s.endsAt.getTime()) - start);
    if (!part) continue;
    const day = DateTime.fromMillis(start, { zone: timeZone }).toISODate()!;
    byDay.set(day, (byDay.get(day) ?? 0) + part);
    ms += part;
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = Math.round(r2(ms / 3_600_000) * 100);
  let given = 0;
  return days.map(([day, partMs], i) => {
    const hundredths = i === days.length - 1 ? total - given : Math.round(partMs / 36_000);
    given += hundredths;
    return { day, hours: hundredths / 100 };
  });
}

const LOOKBACK_DAYS = 90;
/** Longer than any punch, so the window can bound clockIn from below and the index reads only the window. */
const LONGEST_PUNCH_DAYS = 7;

/** A request whose zone is wanted; `asOf` is when it was counted (default now), for the recount report. */
export interface ZoneOf { userId: string; startsAt: Date; asOf?: Date | null }

/**
 * The time zone each request is counted in, the way payroll counts the person's days
 * (payrollRun.ts): their main facility's, the one where they worked the most hours (approved
 * punches) in the 90 days before the request starts, or before now for one that hasn't started.
 * With no hours there, the organization's (orgTimeZone). Every caller uses this, so a request is
 * counted in the same zone in a balance, against the lieu bank and when it's approved.
 * One query for all of them; returns the zone of each request asked about.
 */
export async function leaveTimeZones(tx: Tx, requests: readonly ZoneOf[]): Promise<(r: ZoneOf) => string> {
  const now = new Date();
  const moment = (r: ZoneOf) => Math.min(r.startsAt.getTime(), (r.asOf ?? now).getTime());
  const key = (userId: string, at: number) => `${userId}|${at}`;
  const asked = new Map(requests.map((r) => [key(r.userId, moment(r)), { userId: r.userId, at: moment(r) }]));
  const zones = new Map<string, string>();
  if (asked.size) {
    const qs = [...asked.values()];
    // Per person and moment, the facility with the most hours of punches overlapping the window.
    const rows = await tx.$queryRaw<Array<{ userId: string; at: Date; timezone: string }>>`
      SELECT q."userId"::text AS "userId", q.at, z.timezone
      FROM unnest(${qs.map((q) => q.userId)}::uuid[], ${qs.map((q) => new Date(q.at).toISOString())}::timestamptz[]) AS q("userId", at)
      CROSS JOIN LATERAL (
        SELECT f.timezone FROM "TimePunch" p JOIN "Facility" f ON f.id = p."facilityId"
        WHERE p."userId" = q."userId" AND p.status = 'APPROVED'
          AND p."clockIn" < q.at AND p."clockIn" > q.at - make_interval(days => ${LOOKBACK_DAYS + LONGEST_PUNCH_DAYS}::int)
          AND p."clockOut" > q.at - make_interval(days => ${LOOKBACK_DAYS}::int)
        GROUP BY f.id
        ORDER BY sum(p."clockOut" - p."clockIn") DESC, f.id
        LIMIT 1
      ) z`;
    for (const r of rows) zones.set(key(r.userId, r.at.getTime()), r.timezone);
    if (zones.size < asked.size) {
      const org = await orgTimeZone(tx);
      for (const k of asked.keys()) if (!zones.has(k)) zones.set(k, org);
    }
  }
  return (r) => {
    const z = zones.get(key(r.userId, moment(r)));
    if (!z) throw new Error('leaveTimeZones: this request was not asked about');
    return z;
  };
}

/** One request's zone (leaveTimeZones). */
export async function personLeaveTimeZone(tx: Tx, userId: string, startsAt: Date): Promise<string> {
  const r = { userId, startsAt };
  return (await leaveTimeZones(tx, [r]))(r);
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
 * recounted in the zone it was counted in when it was decided. Nothing is changed here.
 */
export async function weekdayRecount(tx: Tx) {
  const reqs = await tx.timeOffRequest.findMany({
    where: { status: 'APPROVED', chargedBasis: 'WEEKDAYS', chargedHours: { not: null } },
    select: { id: true, userId: true, type: true, startsAt: true, endsAt: true, chargedHours: true, decidedAt: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const zoneOf = await leaveTimeZones(tx, reqs.map((r) => ({ userId: r.userId, startsAt: r.startsAt, asOf: r.decidedAt })));
  const out = [];
  for (const r of reqs) {
    const timeZone = zoneOf({ userId: r.userId, startsAt: r.startsAt, asOf: r.decidedAt });
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
