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

  it('each day of a request is the local day its middle (12 hours in) falls on; the 12:00 tie goes to the later day', () => {
    const zone = 'America/Vancouver';
    // Friday 15:00 + 48 h: the days are mostly Saturday and Sunday.
    expect(weekdayLeaveHours(at('2027-01-15T15:00', zone), at('2027-01-17T15:00', zone), zone)).toBe(0);
    // Friday 12:00 + 48 h: each middle is midnight, which starts the next day.
    expect(weekdayLeaveHours(at('2027-01-15T12:00', zone), at('2027-01-17T12:00', zone), zone)).toBe(0);
    // Friday 11:59 + 48 h: the first day's middle is still Friday.
    expect(weekdayLeaveHours(at('2027-01-15T11:59', zone), at('2027-01-17T11:59', zone), zone)).toBe(8);
  });

  it.each([
    ['America/Toronto', 'America/Vancouver'],
    ['America/St_Johns', 'America/Vancouver'],
    ['UTC', 'America/Vancouver'],
    ['America/Vancouver', 'America/Halifax'],
    ['America/Vancouver', 'America/St_Johns'],
  ])('a Monday–Friday week entered at midnight in %s and counted in %s is 40 hours', (entered, counted) => {
    expect(weekdayLeaveHours(at('2027-01-18T00:00', entered), at('2027-01-23T00:00', entered), counted)).toBe(40);
    expect(weekdayLeaveHours(at('2027-07-12T00:00', entered), at('2027-07-17T00:00', entered), counted)).toBe(40);
  });

  it.each(['America/Toronto', 'America/Halifax', 'America/St_Johns'])('a full Sunday on the spring-forward day (23 hours) is a weekend day in %s: 0', (zone) => {
    expect(weekdayLeaveHours(at('2027-03-14T00:00', zone), at('2027-03-15T00:00', zone), zone)).toBe(0);
    // And the fall-back Sunday (25 hours).
    expect(weekdayLeaveHours(at('2027-11-07T00:00', zone), at('2027-11-08T00:00', zone), zone)).toBe(0);
    // A full Monday after the spring change is still a day.
    expect(weekdayLeaveHours(at('2027-03-15T00:00', zone), at('2027-03-16T00:00', zone), zone)).toBe(8);
  });

  it('keeps the rest: shorter than a day counts its length (at most 8), nothing for an empty request', () => {
    const zone = 'America/Vancouver';
    expect(weekdayLeaveHours(at('2027-01-16T09:00', zone), at('2027-01-16T13:30', zone), zone)).toBe(4.5);
    expect(weekdayLeaveHours(at('2027-01-15T08:00', zone), at('2027-01-15T20:00', zone), zone)).toBe(8);
    expect(weekdayLeaveHours(at('2027-01-15T08:00', zone), at('2027-01-15T08:00', zone), zone)).toBe(0);
  });
});
