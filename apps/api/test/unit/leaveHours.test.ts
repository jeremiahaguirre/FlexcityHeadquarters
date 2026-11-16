import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { leaveHoursFrom, weekdayLeaveHours } from '../../src/services/people/leaveHours.js';

/** An instant from a local wall-clock time in a zone. */
const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toJSDate();
const ZONES = ['America/Vancouver', 'America/Toronto', 'America/Halifax', 'America/St_Johns'];

describe('weekday leave hours count days in the local time zone', () => {
  it('a full day from Friday 08:00 in Vancouver is a Friday: 8 hours', () => {
    const zone = 'America/Vancouver';
    expect(weekdayLeaveHours(at('2027-01-15T08:00', zone), at('2027-01-16T08:00', zone), zone)).toBe(8);
    expect(leaveHoursFrom({ startsAt: at('2027-01-15T08:00', zone), endsAt: at('2027-01-16T08:00', zone) }, [], zone)).toEqual({ hours: 8, basis: 'WEEKDAYS' });
  });

  it('Monday 00:00 in Halifax is a weekday', () => {
    const zone = 'America/Halifax';
    expect(weekdayLeaveHours(at('2027-01-18T00:00', zone), at('2027-01-19T00:00', zone), zone)).toBe(8);
  });

  it.each(ZONES)('a week, Monday to Sunday, is 40 hours in %s', (zone) => {
    expect(weekdayLeaveHours(at('2027-01-18T00:00', zone), at('2027-01-25T00:00', zone), zone)).toBe(40);
    expect(weekdayLeaveHours(at('2027-01-18T08:00', zone), at('2027-01-25T08:00', zone), zone)).toBe(40);
  });

  it.each(ZONES)('a working week from Monday 09:00 to Saturday 09:00 is 40 hours in %s', (zone) => {
    expect(weekdayLeaveHours(at('2027-01-18T09:00', zone), at('2027-01-23T09:00', zone), zone)).toBe(40);
  });

  it.each(ZONES)('weeks across the spring and fall clock changes are still 5 weekdays in %s', (zone) => {
    // Clocks go forward Sunday 14 March 2027 and back Sunday 7 November 2027.
    expect(weekdayLeaveHours(at('2027-03-08T00:00', zone), at('2027-03-15T00:00', zone), zone)).toBe(40);
    expect(weekdayLeaveHours(at('2027-03-08T09:00', zone), at('2027-03-15T09:00', zone), zone)).toBe(40);
    expect(weekdayLeaveHours(at('2027-11-01T00:00', zone), at('2027-11-08T00:00', zone), zone)).toBe(40);
    expect(weekdayLeaveHours(at('2027-11-01T09:00', zone), at('2027-11-08T09:00', zone), zone)).toBe(40);
  });

  it.each(ZONES)('weekend-only leave is 0 in %s', (zone) => {
    expect(weekdayLeaveHours(at('2027-01-16T00:00', zone), at('2027-01-18T00:00', zone), zone)).toBe(0);
    expect(weekdayLeaveHours(at('2027-01-16T09:00', zone), at('2027-01-18T09:00', zone), zone)).toBe(0);
  });

  it('keeps the rest: shorter than a day counts its length (at most 8), nothing for an empty request', () => {
    const zone = 'America/Vancouver';
    expect(weekdayLeaveHours(at('2027-01-16T09:00', zone), at('2027-01-16T13:30', zone), zone)).toBe(4.5);
    expect(weekdayLeaveHours(at('2027-01-15T08:00', zone), at('2027-01-15T20:00', zone), zone)).toBe(8);
    expect(weekdayLeaveHours(at('2027-01-15T08:00', zone), at('2027-01-15T08:00', zone), zone)).toBe(0);
  });
});
