import { describe, expect, it } from 'vitest';
import { validateWindows } from '../../src/services/people/timeOff.js';
import { resolveTiming } from '../../src/services/timeclock/punches.js';
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

describe('offline punch timing', () => {
  const now = new Date('2026-07-06T18:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it('uses the server clock for a punch sent live', () => {
    expect(resolveTiming(undefined, now)).toEqual({ at: now, offline: false, receivedAt: null, skewS: null });
    expect(resolveTiming({ occurredAt: ago(0.2), sentAt: ago(0.2) }, now).offline).toBe(false);
  });
  it('keeps the time a late punch happened and when it arrived', () => {
    const r = resolveTiming({ occurredAt: ago(90), sentAt: now, offline: true }, now);
    expect(r).toEqual({ at: ago(90), offline: true, receivedAt: now, skewS: null });
    // Sent late without saying so still counts as offline.
    expect(resolveTiming({ occurredAt: ago(30) }, now).offline).toBe(true);
  });
  it('corrects the time by how far the phone clock is off', () => {
    // Phone 10 minutes behind: it says 16:20 and "now" is 17:50 on it.
    const r = resolveTiming({ occurredAt: ago(100), sentAt: ago(10), offline: true }, now);
    expect(r.at).toEqual(ago(90));
    expect(r.skewS).toBe(600);
    expect(punchVariance({ clockIn: r.at, clockOut: now, shift: null, locationStatus: 'VERIFIED', recordedOffline: true, clockSkewS: r.skewS }).attention).toEqual(['UNSCHEDULED', 'RECORDED_OFFLINE', 'CLOCK_SKEW']);
  });
  it('allows a little clock drift but refuses the future and very old punches', () => {
    expect(resolveTiming({ occurredAt: new Date(now.getTime() + 60_000), offline: true }, now).at).toEqual(now);
    expect(() => resolveTiming({ occurredAt: new Date(now.getTime() + 5 * 60_000), offline: true }, now)).toThrow(/future/);
    expect(() => resolveTiming({ occurredAt: ago(73 * 60), offline: true }, now)).toThrow(/3 days/);
  });
});
