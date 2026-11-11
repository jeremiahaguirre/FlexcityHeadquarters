import { DateTime } from 'luxon';

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
