/**
 * Accommodation and return-to-work restrictions, enforced by the scheduler.
 * The message never says why: a supervisor only learns that a shift is
 * outside the person's work restrictions.
 */
import type { Decimal } from '../../lib/money.js';
import { dayOfWeek, localDate, localIso } from '../../lib/time.js';

export interface Restriction {
  startsOn: string;
  endsOn: string | null;
  maxShiftHours: number | null;
  maxWeeklyHours: number | null;
  noStartBefore: number | null;
  noEndAfter: number | null;
  daysOff: number[];
  excludedPositionIds: string[];
}

const MESSAGE = "Outside this person's work restrictions.";
const minuteOf = (at: Date, tz: string) => {
  const hm = localIso(at, tz).slice(11, 16);
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
};

/** Reasons this shift breaks an active restriction (one generic message, never the detail). */
export function accommodationBlocks(rs: Restriction[], shift: { start: Date; end: Date; positionId: string; timezone: string }, weeklyHoursAfter: Decimal): string[] {
  const day = localDate(shift.start, shift.timezone);
  const active = rs.filter((r) => r.startsOn <= day && (!r.endsOn || r.endsOn >= day));
  for (const r of active) {
    const hours = (shift.end.getTime() - shift.start.getTime()) / 3_600_000;
    const endMinute = minuteOf(new Date(shift.end.getTime() - 1), shift.timezone) + 1;
    if (
      r.excludedPositionIds.includes(shift.positionId) ||
      (r.maxShiftHours !== null && hours > r.maxShiftHours) ||
      (r.maxWeeklyHours !== null && Number(weeklyHoursAfter.toString()) > r.maxWeeklyHours) ||
      (r.noStartBefore !== null && minuteOf(shift.start, shift.timezone) < r.noStartBefore) ||
      (r.noEndAfter !== null && endMinute > r.noEndAfter) ||
      r.daysOff.includes(dayOfWeek(day))
    ) {
      return [MESSAGE];
    }
  }
  return [];
}
