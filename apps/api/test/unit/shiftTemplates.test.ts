/** Weekly shift templates (occurrences, dates, closures) and stated shift preferences (matching, solver weights). */
import { describe, expect, it } from 'vitest';
import { classify, clampRange, slotBody, templateBody, templateOccurrences } from '../../src/services/scheduling/shiftTemplates.js';
import { type StatedPreferences, preferenceScore, preferencesBody, windowMatches } from '../../src/services/scheduling/preferences.js';
import { solve } from '../../src/services/scheduling/solver.js';
const TOR = 'America/Toronto';
import { options, person, slot } from '../solverFixtures.js';

const line = (over: Partial<{ id: string; daysOfWeek: number[]; startMinute: number; endMinute: number; facilityId: string; positionId: string; headcount: number }> = {}) => ({
  id: 's1',
  daysOfWeek: [1, 2, 3, 4, 5],
  startMinute: 7 * 60,
  endMinute: 15 * 60,
  facilityId: 'f1',
  positionId: 'p1',
  headcount: 2,
  ...over,
});

describe('template occurrences', () => {
  it('makes one occurrence per chosen weekday, wall-clock in the facility’s time zone', () => {
    // 2026-11-02 is a Monday; a week to 2026-11-09.
    const occ = templateOccurrences([line()], '2026-11-02', '2026-11-09', () => TOR);
    expect(occ.map((o) => o.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(occ[0]!.start.toISOString()).toBe('2026-11-02T12:00:00.000Z'); // 07:00 EST
    expect(occ[0]!.end.toISOString()).toBe('2026-11-02T20:00:00.000Z');
  });

  it('keeps 07:00 on a DST changeover day and runs an overnight line into the next morning', () => {
    // 2026-11-01 (Sunday): clocks fall back in Toronto.
    const [day] = templateOccurrences([line({ daysOfWeek: [0] })], '2026-11-01', '2026-11-02', () => TOR);
    expect(day!.start.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    const [night] = templateOccurrences([line({ daysOfWeek: [6], startMinute: 23 * 60, endMinute: 31 * 60 })], '2026-10-31', '2026-11-01', () => TOR);
    // Saturday 23:00 EDT → Sunday 07:00 EST: 9 real hours across the changeover.
    expect((night!.end.getTime() - night!.start.getTime()) / 3_600_000).toBe(9);
  });

  it('bounds a range by the template’s own dates (inclusive end)', () => {
    expect(clampRange('2026-06-01', '2026-06-15', '2026-06-08', null)).toEqual({ from: '2026-06-08', to: '2026-06-15' });
    expect(clampRange('2026-06-01', '2026-06-15', null, '2026-06-03')).toEqual({ from: '2026-06-01', to: '2026-06-04' });
    expect(clampRange('2026-06-01', '2026-06-15', '2026-07-01', null)).toBeNull();
  });
});

describe('closures and flags', () => {
  const hours = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, opensMinute: 6 * 60, closesMinute: 21 * 60 }));
  it('skips a statutory holiday at a facility closed on holidays, flags it elsewhere', () => {
    expect(classify(line(), '2026-11-11', { holiday: true, closedOnHolidays: true, hours: [] })).toEqual({ skip: true, code: 'HOLIDAY_CLOSED' });
    expect(classify(line(), '2026-11-11', { holiday: true, closedOnHolidays: false, hours: [] })).toEqual({ skip: false, code: 'STAT_HOLIDAY' });
  });
  it('skips a day the facility has no opening hours; flags a line outside them', () => {
    expect(classify(line(), '2026-11-08', { holiday: false, closedOnHolidays: false, hours })).toEqual({ skip: true, code: 'FACILITY_CLOSED' }); // Sunday
    expect(classify(line({ startMinute: 5 * 60 }), '2026-11-09', { holiday: false, closedOnHolidays: false, hours })).toEqual({ skip: false, code: 'OUTSIDE_HOURS' });
    expect(classify(line(), '2026-11-09', { holiday: false, closedOnHolidays: false, hours })).toEqual({ skip: false, code: null });
    // No opening hours kept at all: always open.
    expect(classify(line(), '2026-11-08', { holiday: false, closedOnHolidays: false, hours: [] })).toEqual({ skip: false, code: null });
  });
});

describe('template and preference input', () => {
  const uuid = '00000000-0000-4000-8000-000000000001';
  it('refuses lines that end before they start or run past 16 hours, and reversed dates', () => {
    expect(slotBody.safeParse({ daysOfWeek: [1], startMinute: 600, endMinute: 540, facilityId: uuid, positionId: uuid, headcount: 1 }).success).toBe(false);
    expect(slotBody.safeParse({ daysOfWeek: [1], startMinute: 0, endMinute: 17 * 60, facilityId: uuid, positionId: uuid, headcount: 1 }).success).toBe(false);
    expect(slotBody.safeParse({ daysOfWeek: [], startMinute: 0, endMinute: 60, facilityId: uuid, positionId: uuid, headcount: 1 }).success).toBe(false);
    const ok = { daysOfWeek: [6], startMinute: 22 * 60, endMinute: 30 * 60, facilityId: uuid, positionId: uuid, headcount: 3 };
    expect(slotBody.safeParse(ok).success).toBe(true);
    expect(templateBody.safeParse({ name: 'Summer', validFrom: '2026-09-01', validTo: '2026-06-01', slots: [ok] }).success).toBe(false);
  });
  it('a preference window needs both ends or neither', () => {
    expect(preferencesBody.safeParse({ preferences: [{ kind: 'PREFER', startMinute: 420 }] }).success).toBe(false);
    expect(preferencesBody.safeParse({ preferences: [{ kind: 'AVOID', daysOfWeek: [0] }], maxWeeklyHours: 24 }).success).toBe(true);
  });
});

describe('preference matching', () => {
  const shift = { dow: 1, startMinute: 7 * 60, positionId: 'p1', facilityId: 'f1' };
  it('matches on day, start inside the window, position and facility', () => {
    expect(windowMatches({ kind: 'PREFER', daysOfWeek: [1, 2], startMinute: 360, endMinute: 720, positionId: null, facilityId: null }, shift)).toBe(true);
    expect(windowMatches({ kind: 'PREFER', daysOfWeek: [2], startMinute: null, endMinute: null, positionId: null, facilityId: null }, shift)).toBe(false);
    expect(windowMatches({ kind: 'PREFER', daysOfWeek: [], startMinute: 720, endMinute: 1200, positionId: null, facilityId: null }, shift)).toBe(false);
    expect(windowMatches({ kind: 'PREFER', daysOfWeek: [], startMinute: null, endMinute: null, positionId: 'p2', facilityId: null }, shift)).toBe(false);
    expect(windowMatches({ kind: 'PREFER', daysOfWeek: [], startMinute: null, endMinute: null, positionId: null, facilityId: 'f2' }, shift)).toBe(false);
  });
  it('avoid wins over prefer', () => {
    const p: StatedPreferences = { windows: [{ kind: 'PREFER', daysOfWeek: [1], startMinute: null, endMinute: null, positionId: null, facilityId: null }, { kind: 'AVOID', daysOfWeek: [], startMinute: 360, endMinute: 480, positionId: null, facilityId: null }], maxWeeklyHours: null, maxDaysPerWeek: null };
    expect(preferenceScore(p, shift)).toBe(-1);
    expect(preferenceScore(p, { ...shift, startMinute: 600 })).toBe(1);
    expect(preferenceScore(undefined, shift)).toBe(0);
  });
});

describe('solve: stated preferences (soft)', () => {
  // 2026-07-06 is a Monday.
  const monday = slot('mon', '2026-07-06 07:00', '2026-07-06 15:00');
  const prefers = (days: number[], kind: 'PREFER' | 'AVOID' = 'PREFER'): StatedPreferences => ({ windows: [{ kind, daysOfWeek: days, startMinute: null, endMinute: null, positionId: null, facilityId: null }], maxWeeklyHours: null, maxDaysPerWeek: null });

  it('gives the shift to the person who prefers it, and says so', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = solve({ slots: [monday], people: [person('a'), person('b', { preferences: prefers([1]) }), person('c')], options: options({ seed }) });
      expect(r.proposals[0]!.userId).toBe('b');
      expect(r.proposals[0]!.reasons.map((x) => x.code)).toContain('PREFERENCE_MET');
    }
  });

  it('keeps people off shifts they’d rather avoid when someone else can work it', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = solve({ slots: [monday], people: [person('a', { preferences: prefers([1], 'AVOID') }), person('b', { preferences: prefers([1], 'AVOID') }), person('c')], options: options({ seed }) });
      expect(r.proposals[0]!.userId).toBe('c');
    }
  });

  it('never leaves a shift open for a preference, and explains when it wasn’t honoured', () => {
    const r = solve({ slots: [monday], people: [person('a', { preferences: prefers([1], 'AVOID') })], options: options() });
    expect(r.proposals[0]!.userId).toBe('a');
    expect(r.proposals[0]!.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['PREFERENCE_AVOIDED', 'ONLY_OPTION']));
  });

  it('never overrides a hard rule: someone outside their availability isn’t placed because they prefer it', () => {
    const r = solve({ slots: [monday], people: [person('a', { preferences: prefers([1]), availability: [] }), person('b')], options: options() });
    expect(r.proposals[0]!.userId).toBe('b');
  });

  it('weighs the most hours a week someone would like', () => {
    const week = ['2026-07-06', '2026-07-07', '2026-07-08'].map((d, i) => slot(`d${i}`, `${d} 07:00`, `${d} 15:00`));
    const r = solve({ slots: week, people: [person('a', { preferences: { windows: [], maxWeeklyHours: 8, maxDaysPerWeek: null } }), person('b')], options: options({ seed: 3 }) });
    const a = r.proposals.filter((p) => p.userId === 'a').length;
    expect(a).toBeLessThanOrEqual(1);
  });

  it('has no influence when the preferences weight is 0', () => {
    const base = { slots: [monday], people: [person('a'), person('b', { preferences: prefers([1], 'AVOID') })] };
    const w0 = solve({ ...base, options: options({ seed: 7, weights: { ...options().weights, preferences: 0 } }) });
    const none = solve({ slots: [monday], people: [person('a'), person('b')], options: options({ seed: 7, weights: { ...options().weights, preferences: 0 } }) });
    expect(w0.proposals[0]!.userId).toBe(none.proposals[0]!.userId);
  });
});
