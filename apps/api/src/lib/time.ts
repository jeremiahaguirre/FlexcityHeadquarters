/** Dates and times in an organization's own time zone (shifts, pay weeks, local days). */
import { DateTime } from 'luxon';
import { z } from 'zod';
import { HttpError, invalid } from './errors.js';

/**
 * Time-zone conversions are the slowest part of checking a shift (each one formats a date
 * through Intl). These functions are pure, so batch work (a month of shifts × a department,
 * a pay run) remembers recent answers. Bounded: the memory is dropped past a limit.
 */
const LIMIT = 20_000;
function remember<A extends unknown[], R>(fn: (...a: A) => R, key: (...a: A) => string): (...a: A) => R {
  const m = new Map<string, R>();
  return (...a: A) => {
    const k = key(...a);
    const hit = m.get(k);
    if (hit !== undefined) return hit;
    const r = fn(...a);
    if (m.size >= LIMIT) m.clear();
    m.set(k, r);
    return r;
  };
}

/** Half-open interval [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

/** True when two half-open intervals share any time. Touching end-to-start is NOT an overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/** ISO local date ("2026-07-01") of an instant in a timezone. */
export const localDate = remember(
  (at: Date, timezone: string): string => DateTime.fromJSDate(at, { zone: timezone }).toISODate()!,
  (at, timezone) => `${timezone}|${at.getTime()}`,
);

/** Facility-local ISO timestamp with offset, e.g. "2026-11-13T07:00:00.000-07:00". */
export function localIso(at: Date, timezone: string): string {
  return DateTime.fromJSDate(at, { zone: timezone }).toISO()!;
}

/** The instant of a local wall-clock hour on a date (DST-safe: 9 a.m. is 9 a.m. on changeover days too). */
export function localHour(isoDate: string, hour: number, timezone: string): Date {
  return DateTime.fromISO(isoDate, { zone: timezone }).startOf('day').set({ hour }).toJSDate();
}

/** Start instant of a local calendar date in a timezone (DST-safe). */
const startOfLocalDayMs = remember(
  (isoDate: string, timezone: string): number => DateTime.fromISO(isoDate, { zone: timezone }).startOf('day').toMillis(),
  (isoDate, timezone) => `${timezone}|${isoDate}`,
);
export function startOfLocalDay(isoDate: string, timezone: string): Date {
  return new Date(startOfLocalDayMs(isoDate, timezone));
}

/**
 * Splits an interval at local midnights so each piece lies within one local
 * calendar day. A 22:00–06:00 shift becomes two pieces on two work days.
 */
export function splitByLocalDay(interval: Interval, timezone: string): Array<Interval & { localDate: string }> {
  return splitCached(interval.start.getTime(), interval.end.getTime(), timezone).map((p) => ({ start: new Date(p.start), end: new Date(p.end), localDate: p.localDate }));
}
const splitCached = remember(
  (start: number, end: number, timezone: string) => splitByLocalDayUncached({ start: new Date(start), end: new Date(end) }, timezone).map((p) => ({ start: p.start.getTime(), end: p.end.getTime(), localDate: p.localDate })),
  (start, end, timezone) => `${timezone}|${start}|${end}`,
);
function splitByLocalDayUncached(
  interval: Interval,
  timezone: string,
): Array<Interval & { localDate: string }> {
  const out: Array<Interval & { localDate: string }> = [];
  let cursor = DateTime.fromJSDate(interval.start, { zone: timezone });
  const end = DateTime.fromJSDate(interval.end, { zone: timezone });
  while (cursor < end) {
    const nextMidnight = cursor.startOf('day').plus({ days: 1 });
    const pieceEnd = nextMidnight < end ? nextMidnight : end;
    out.push({ start: cursor.toJSDate(), end: pieceEnd.toJSDate(), localDate: cursor.toISODate()! });
    cursor = pieceEnd;
  }
  return out;
}

/** Local ISO date of the first day of the pay week containing `isoDate`. weekStartDay: 0=Sunday. */
export const payWeekStart = remember(
  (isoDate: string, weekStartDay: number): string => {
    const d = DateTime.fromISO(isoDate);
    const dow = d.weekday % 7; // luxon: Mon=1..Sun=7 → Sun=0
    const back = (dow - weekStartDay + 7) % 7;
    return d.minus({ days: back }).toISODate()!;
  },
  (isoDate, weekStartDay) => `${isoDate}|${weekStartDay}`,
);

export const addDays = remember((isoDate: string, days: number): string => DateTime.fromISO(isoDate).plus({ days }).toISODate()!, (isoDate, days) => `${isoDate}|${days}`);

export const dayOfWeek = remember((isoDate: string): number => DateTime.fromISO(isoDate).weekday % 7, (isoDate) => isoDate);

/** Whole years between two ISO dates (age, years of service). */
export function wholeYearsBetween(fromIso: string, toIso: string): number {
  return Math.floor(DateTime.fromISO(toIso).diff(DateTime.fromISO(fromIso), 'years').years);
}

/** Merge overlapping/adjacent intervals. Input need not be sorted. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

/**
 * A facility-local wall-clock time, as a date-time picker sends it (2026-11-14T06:30), optionally
 * with the UTC offset that says which one is meant on the night clocks go back (…T01:30-07:00).
 */
export const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}([+-]\d{2}:\d{2})?$/);

const WALL = "yyyy-MM-dd'T'HH:mm";

/**
 * That wall-clock time in a time zone, as an instant. A time that doesn't exist (skipped when clocks
 * go forward) is refused; a time that happens twice (clocks go back) needs its offset, and the error
 * lists the two offsets to choose from. `field` names the input in those errors.
 */
export function atLocal(local: string, timezone: string, field = 'time'): Date {
  const wall = local.slice(0, 16);
  if (local.length > 16) {
    const at = DateTime.fromISO(local, { setZone: true });
    if (!at.isValid || at.setZone(timezone).toFormat(WALL) !== wall) throw new HttpError(400, 'BAD_TIME_OFFSET', 'That time and offset don’t match the facility’s time zone.', { field });
    return at.toJSDate();
  }
  const at = DateTime.fromISO(wall, { zone: timezone });
  if (!at.isValid) throw invalid('BAD_TIME', 'That date and time aren’t valid.', { field });
  if (at.toFormat(WALL) !== wall) throw new HttpError(400, 'TIME_NOT_EXIST', 'That time doesn’t exist: the clocks went forward then.', { field });
  // The same wall time an hour either side of the change: two different instants means it happened twice.
  const offsets = new Set<string>();
  for (const probe of [-3, 3].map((h) => DateTime.fromMillis(at.toMillis() + h * 3_600_000, { zone: timezone }))) {
    const candidate = DateTime.fromISO(`${wall}${probe.toFormat('ZZ')}`, { setZone: true });
    if (candidate.isValid && candidate.setZone(timezone).toFormat(WALL) === wall) offsets.add(probe.toFormat('ZZ'));
  }
  if (offsets.size > 1) throw new HttpError(400, 'AMBIGUOUS_TIME', 'That time happened twice (the clocks went back). Say which one.', { field, offsets: [...offsets] });
  return at.toJSDate();
}
