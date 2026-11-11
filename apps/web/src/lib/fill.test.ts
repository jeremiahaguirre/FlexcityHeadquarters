import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { type FillWeek, acceptBody, beyondWindow, emptyReview, grouped, itemsOf, summarize, weeksOf } from './fill';

const slot = (id: string, start: string, over: object = {}) => ({ id, version: 2, facilityId: 'f', facilityName: 'Pool', positionId: 'g', position: { name: 'Lifeguard', nameFr: 'Sauveteur' }, customTitle: null, localStartsAt: start, localEndsAt: start.replace('T09', 'T13'), hours: 4, currentUserId: null, tentative: false, ...over });
const week = (start: string, over: Partial<FillWeek> = {}): FillWeek => ({
  week: { start, index: 0, tentative: false, beyondWindowFrom: '2026-12-01' },
  settings: { useSeniority: false, toggles: { keepAssigned: true, avoidOvertime: true, spreadWeekends: true, sameFacility: true }, planAheadWeeks: 2 },
  summary: { slots: 3, filled: 2, overtimeHours: 0, overtimeCost: 0, hours: { stdev: 1 }, ms: 10 },
  proposals: [],
  unfilled: [],
  coverageGaps: [],
  slots: [],
  people: {},
  carry: [],
  ...over,
});

const w1 = week('2026-11-16', {
  slots: [slot('a', '2026-11-17T09:00:00-08:00'), slot('b', '2026-11-16T09:00:00-08:00'), slot('c', '2026-11-17T09:00:00-08:00')],
  proposals: [
    { slotId: 'a', userId: 'u1', previousUserId: null, hoursBefore: 0, weekHours: 4, overtimeHours: 0, tentative: false, reasons: [], alternatives: [{ userId: 'u2', hoursBefore: 0, overtimeHours: 0, reasons: [] }] },
    { slotId: 'b', userId: 'u2', previousUserId: null, hoursBefore: 0, weekHours: 4, overtimeHours: 0, tentative: false, reasons: [], alternatives: [] },
  ],
  unfilled: [{ slotId: 'c', qualified: 2, counts: [{ code: 'ON_APPROVED_TIME_OFF', count: 2 }], overtimeOption: null }],
});
const w2 = week('2026-11-23', { week: { start: '2026-11-23', index: 1, tentative: true, beyondWindowFrom: '2026-11-25' }, summary: { slots: 1, filled: 1, overtimeHours: 2, overtimeCost: 75, hours: { stdev: 1 }, ms: 5 }, slots: [slot('d', '2026-11-24T09:00:00-08:00', { tentative: true })], proposals: [{ slotId: 'd', userId: 'u1', previousUserId: null, hoursBefore: 4, weekHours: 8, overtimeHours: 2, tentative: true, reasons: [], alternatives: [] }] });

describe('fill review helpers', () => {
  it('lists the weeks of a horizon', () => {
    expect(weeksOf('2026-11-16', 2)).toEqual(['2026-11-16', '2026-11-23']);
    expect(weeksOf('2026-11-16', 13)).toHaveLength(13);
  });

  it('notes when the horizon goes past the plan-ahead window', () => {
    expect(beyondWindow(4, 2)).toBe(true);
    expect(beyondWindow(2, 2)).toBe(false);
  });

  it('groups by week then day, in time order', () => {
    const g = grouped(itemsOf([w1, w2]));
    expect(g.map((w) => w.week)).toEqual(['2026-11-16', '2026-11-23']);
    expect(g[0]!.days.map((d) => [d.day, d.items.map((i) => i.slot.id)])).toEqual([
      ['2026-11-16', ['b']],
      ['2026-11-17', ['a', 'c']],
    ]);
  });

  it('summarizes in plain terms: filled, overtime, what needs you, tentative', () => {
    const items = itemsOf([w1, w2]);
    expect(summarize([w1, w2], items, emptyReview())).toEqual({ total: 4, filled: 3, needYou: 1, overtimeHours: 2, overtimeCost: 75, tentative: 1 });
    const r = { ...emptyReview(), declined: { a: true as const }, handled: { c: true as const } };
    expect(summarize([w1, w2], items, r)).toMatchObject({ filled: 2, needYou: 1 });
  });

  it('accepts the chosen person, skipping declined and already accepted', () => {
    const items = itemsOf([w1, w2]);
    const r = { ...emptyReview(), choice: { a: 'u2' }, declined: { d: true as const }, accepted: { b: true as const } };
    expect(acceptBody(items, r)).toEqual([{ shiftId: 'a', userId: 'u2', expectedVersion: 2, previousUserId: null }]);
  });

  it('has words for every horizon, reason and block in both languages', () => {
    for (const dict of [en, fr]) {
      expect(Object.keys(dict.fill.horizon)).toEqual(['1', '2', '4', '13']);
      expect(Object.keys(dict.fill.why).sort()).toEqual(Object.keys(en.fill.why).sort());
      expect(dict.notifications.availability_reminder).toContain('{{through}}');
    }
    expect(fr.fill.horizon['13']).toBe('3 mois');
    expect(en.fill.horizon['4']).toBe('Month');
  });
});
