/**
 * How many hours of leave a time-off request uses.
 *
 * What counts is the person's own schedule: the hours of their shifts that fall inside the
 * request (a 10-hour shift off is 10 hours, a weekend shift counts, a day they weren't
 * scheduled doesn't). When nothing is scheduled there, it falls back to a working day
 * (8 hours) for each weekday the request spans, or its length if shorter than a day.
 */
import { DateTime } from 'luxon';
import type { Province } from '../../generated/prisma/client.js';
import type { Tx } from '../../lib/db.js';
import { holidaysTouching, organizationDay, statutoryDay } from '../payroll/holidayRules.js';

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

/**
 * How many of the weekday-fallback days of a request are holidays (`daysOff`, YYYY-MM-DD), each
 * day read the same way as weekdayLeaveHours: in the local calendar of `timeZone`, the local day
 * its middle falls on; a request shorter than a local day is its start's local day.
 */
export function holidayWeekdays(startsAt: Date, endsAt: Date, daysOff: ReadonlySet<string>, timeZone: string): number {
  if (endsAt <= startsAt || !daysOff.size) return 0;
  const first = DateTime.fromJSDate(startsAt, { zone: timeZone });
  const length = DateTime.fromJSDate(endsAt, { zone: timeZone }).diff(first, 'days').days;
  const days = length < 1 ? [first] : Array.from({ length: Math.round(length) }, (_, i) => first.plus({ days: i }).plus({ hours: 12 }));
  return days.filter((d) => d.weekday <= 5 && daysOff.has(d.toISODate()!)).length;
}

/**
 * leaveHoursFrom, without the holidays the person is off for: when nothing is scheduled, a
 * statutory holiday, a city-added holiday or a closure day inside the request isn't charged.
 * (Scheduled shifts are charged as they are: someone scheduled on a holiday who takes it off uses leave.)
 */
export function leaveHoursOff(request: Interval, shifts: Interval[], timeZone: string, daysOff: ReadonlySet<string>): { hours: number; basis: LeaveBasis } {
  const r = leaveHoursFrom(request, shifts, timeZone);
  if (r.basis !== 'WEEKDAYS' || !daysOff.size) return r;
  const off = holidayWeekdays(request.startsAt, request.endsAt, daysOff, timeZone);
  if (!off) return r;
  const length = DateTime.fromJSDate(request.endsAt, { zone: timeZone }).diff(DateTime.fromJSDate(request.startsAt, { zone: timeZone }), 'days').days;
  return { hours: length < 1 ? 0 : Math.max(0, r.hours - off * HOURS_PER_DAY), basis: r.basis };
}

/**
 * Each person's province for holidays, the way leaveTimeZones finds their zone: their main
 * facility's (most approved punch hours in the 90 days before `at`), else the organization's oldest
 * facility's; null when the organization has no facility.
 */
export async function leaveProvinces(tx: Tx, userIds: string[], at: Date): Promise<Map<string, Province | null>> {
  const ids = [...new Set(userIds)];
  const rows = ids.length
    ? await tx.$queryRaw<Array<{ userId: string; province: Province }>>`
        SELECT DISTINCT ON (p."userId") p."userId"::text AS "userId", f.province
        FROM "TimePunch" p JOIN "Facility" f ON f.id = p."facilityId"
        WHERE p."userId" = ANY(${ids}::uuid[]) AND p.status = 'APPROVED' AND p."clockOut" IS NOT NULL
          AND p."clockOut" > ${new Date(at.getTime() - LOOKBACK_MS)} AND p."clockIn" < ${at}
        GROUP BY p."userId", f.id
        ORDER BY p."userId", sum(p."clockOut" - p."clockIn") DESC, f.id`
    : [];
  const out = new Map<string, Province | null>(rows.map((r) => [r.userId, r.province]));
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const org = (await tx.facility.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { province: true } }))?.province ?? null;
    for (const id of missing) out.set(id, org);
  }
  return out;
}

/**
 * The days off for holidays in a province over a period, for leave: each holiday's statutory day
 * and the day the organization observes it, and the organization's own paid holidays and closure
 * days (TenantHoliday).
 */
export async function leaveDaysOff(tx: Tx, province: Province | null, from: Date, to: Date): Promise<Set<string>> {
  if (!province) return new Set();
  const t = await tx.tenant.findFirst({ select: { holidayObservance: true } });
  if (!t) return new Set();
  const a = new Date(from.getTime() - 86_400_000).toISOString().slice(0, 10);
  const b = new Date(to.getTime() + 86_400_000).toISOString().slice(0, 10);
  return new Set((await holidaysTouching(tx, province, a, b)).flatMap((h) => [statutoryDay(h), organizationDay(h, t.holidayObservance)]));
}

/** One person's holiday days off around a request (their province as of its start, or now for one ahead). */
export async function personLeaveDaysOff(tx: Tx, userId: string, startsAt: Date, endsAt: Date, now = new Date()): Promise<Set<string>> {
  const province = (await leaveProvinces(tx, [userId], new Date(Math.min(startsAt.getTime(), now.getTime())))).get(userId) ?? null;
  return leaveDaysOff(tx, province, startsAt, endsAt);
}

/** The person's scheduled shifts overlapping a period (cancelled ones don't count). */
export function scheduledShifts(tx: Tx, userIds: string[], from: Date, to: Date) {
  return tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true } });
}
