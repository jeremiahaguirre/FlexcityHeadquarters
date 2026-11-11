/**
 * What a "day" is for daily overtime and daily hour limits. One function, used by payroll
 * (payCalc daily overtime) and by scheduling (overtime projections, max hours a day), so the
 * pay stub and the schedule can never disagree.
 *
 * - 'calendar': each local calendar day (midnight to midnight). Most provinces.
 * - 'shift_start_past_midnight': a shift that continues past midnight starts a 24-hour "day" at
 *   the shift's start; everything worked inside those 24 hours is that day. Other time is
 *   counted by calendar day, as usual. Our reading of BC ESA s. 1 ("day" (b)) and the Alberta
 *   Employment Standards Code ("work day": 24 hours from the start of work), PENDING COUNSEL
 *   REVIEW (docs/COMPLIANCE.md). Windows never overlap: a rolling day cuts the calendar day it
 *   starts in, and the remainder of the calendar day after it ends is a day of its own.
 */
import type { Interval } from '../../lib/time.js';
import { addDays, localDate, startOfLocalDay } from '../../lib/time.js';

export type DayDefinition = 'calendar' | 'shift_start_past_midnight';

export interface WorkDayWindow {
  start: number;
  end: number;
  /** Local date the window starts on (for labels). */
  date: string;
  /** Unique, sorts in time order. */
  key: string;
}

const DAY = 86_400_000;

/** The day windows covering every interval given (sorted by start). */
export function workDayWindows(intervals: ReadonlyArray<Interval>, tz: string, def: DayDefinition = 'calendar'): WorkDayWindow[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const rolling: Array<{ start: number; end: number }> = [];
  if (def === 'shift_start_past_midnight') {
    for (const s of sorted) {
      const a = s.start.getTime();
      const crosses = localDate(s.start, tz) !== localDate(new Date(s.end.getTime() - 1), tz);
      if (!crosses) continue;
      if (rolling.some((r) => a >= r.start && a < r.end)) continue; // already inside another 24-hour day
      rolling.push({ start: a, end: a + DAY });
    }
  }
  const lo = Math.min(...sorted.map((s) => s.start.getTime()));
  const hi = Math.max(...sorted.map((s) => s.end.getTime()));
  const out: WorkDayWindow[] = [];
  const pad = (ms: number) => String(ms).padStart(15, '0');
  for (let d = localDate(new Date(lo), tz); startOfLocalDay(d, tz).getTime() < hi; d = addDays(d, 1)) {
    const ds = startOfLocalDay(d, tz).getTime();
    const de = startOfLocalDay(addDays(d, 1), tz).getTime();
    // The calendar day minus any rolling days.
    let cursor = ds;
    for (const r of rolling.filter((x) => x.start < de && x.end > ds).sort((x, y) => x.start - y.start)) {
      if (r.start > cursor) out.push({ start: cursor, end: r.start, date: d, key: pad(cursor) });
      cursor = Math.max(cursor, r.end);
    }
    if (cursor < de) out.push({ start: cursor, end: de, date: localDate(new Date(cursor), tz), key: pad(cursor) });
  }
  for (const r of rolling) out.push({ start: r.start, end: r.end, date: localDate(new Date(r.start), tz), key: pad(r.start) });
  return out.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
}

/** Hours worked inside each window that any of `touching` overlaps. */
export function hoursPerWorkDay(all: ReadonlyArray<Interval>, tz: string, def: DayDefinition): Array<WorkDayWindow & { hours: number }> {
  return workDayWindows(all, tz, def).map((w) => ({
    ...w,
    hours: all.reduce((s, i) => s + Math.max(0, Math.min(i.end.getTime(), w.end) - Math.max(i.start.getTime(), w.start)), 0) / 3_600_000,
  }));
}
