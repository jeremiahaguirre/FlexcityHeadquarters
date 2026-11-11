/** School days, for the youth work-hour limits that differ on school days. */
import { DateTime } from 'luxon';
import { DEFAULT_SCHOOL_CALENDAR, type SchoolCalendar } from '../scheduling/eligibility.js';

export interface SchoolPeriod {
  kind: 'TERM' | 'BREAK';
  startsOn: string; // ISO date, inclusive
  endsOn: string; // ISO date, inclusive
}

/**
 * The organization's school calendar: a weekday is a school day when it falls in
 * a TERM and not in a BREAK. With no terms entered, the default (weekdays from
 * September to June) applies and eligibility results carry no extra warning.
 */
export function buildSchoolCalendar(periods: SchoolPeriod[]): SchoolCalendar {
  const terms = periods.filter((p) => p.kind === 'TERM');
  if (terms.length === 0) return DEFAULT_SCHOOL_CALENDAR;
  const breaks = periods.filter((p) => p.kind === 'BREAK');
  const within = (d: string, p: SchoolPeriod) => p.startsOn <= d && d <= p.endsOn;
  return {
    isSchoolDay(iso) {
      if (DateTime.fromISO(iso).weekday > 5) return false;
      return terms.some((t) => within(iso, t)) && !breaks.some((b) => within(iso, b));
    },
    schoolHours: DEFAULT_SCHOOL_CALENDAR.schoolHours,
  };
}
