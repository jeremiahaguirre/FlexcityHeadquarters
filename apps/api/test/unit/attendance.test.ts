import { describe, expect, it } from 'vitest';
import { validateWindows } from '../../src/services/people/timeOff.js';
import { punchVariance } from '../../src/services/timeclock/review.js';

describe('availability windows', () => {
  it('accepts non-overlapping windows', () => {
    expect(() => validateWindows([{ dayOfWeek: 1, startMinute: 360, endMinute: 720 }, { dayOfWeek: 1, startMinute: 780, endMinute: 1320 }])).not.toThrow();
  });
  it('rejects overlaps on the same day', () => {
    expect(() => validateWindows([{ dayOfWeek: 1, startMinute: 360, endMinute: 720 }, { dayOfWeek: 1, startMinute: 700, endMinute: 900 }])).toThrow(/overlap/);
  });
  it('rejects windows that end before they start', () => {
    expect(() => validateWindows([{ dayOfWeek: 2, startMinute: 600, endMinute: 600 }])).toThrow(/start before/);
  });
});

describe('punch variance', () => {
  const shift = { startsAt: new Date('2026-07-06T15:00:00Z'), endsAt: new Date('2026-07-06T19:00:00Z') };
  it('is quiet within the 7-minute tolerance', () => {
    const v = punchVariance({ clockIn: new Date('2026-07-06T15:05:00Z'), clockOut: new Date('2026-07-06T19:03:00Z'), shift, locationStatus: 'VERIFIED' });
    expect(v).toEqual({ startMinutes: 5, endMinutes: 3, attention: [] });
  });
  it('flags late starts, early exits and off-site punches', () => {
    const v = punchVariance({ clockIn: new Date('2026-07-06T15:20:00Z'), clockOut: new Date('2026-07-06T18:30:00Z'), shift, locationStatus: 'OUTSIDE_RADIUS' });
    expect(v.attention).toEqual(['LATE_START', 'LEFT_EARLY', 'OUTSIDE_GEOFENCE']);
  });
  it('flags unscheduled and unfinished punches', () => {
    const v = punchVariance({ clockIn: new Date(), clockOut: null, shift: null, locationStatus: 'NO_LOCATION' });
    expect(v.attention).toEqual(['UNSCHEDULED', 'NO_CLOCK_OUT', 'LOCATION_UNVERIFIED']);
  });
});
