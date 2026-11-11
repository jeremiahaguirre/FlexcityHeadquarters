import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { daysLabel, endAfter, fromHHMM, preferenceSummary, toHHMM, weekTotals } from './shiftTemplates';

/** A tiny t() over the real dictionaries (enough for {{x}} and _one/_other). */
const tFor = (dict: unknown) => (key: string, o: Record<string, unknown> = {}) => {
  const get = (k: string) => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], dict);
  const raw = (typeof o.count === 'number' ? get(`${key}_${o.count === 1 ? 'one' : 'other'}`) : undefined) ?? get(key);
  return String(raw ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(o[k] ?? ''));
};

describe('shift template helpers', () => {
  it('names day runs Monday first, as a range from three days', () => {
    expect(daysLabel([1, 2, 3, 4, 5], 'en-CA', 'Every day')).toBe('Mon–Fri');
    expect(daysLabel([6, 0], 'en-CA', 'Every day')).toBe('Sat, Sun');
    expect(daysLabel([1, 3, 5], 'en-CA', 'Every day')).toBe('Mon, Wed, Fri');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6], 'en-CA', 'Every day')).toBe('Every day');
  });

  it('times: HH:MM both ways, and an end at or before the start runs past midnight', () => {
    expect(toHHMM(7 * 60 + 30)).toBe('07:30');
    expect(toHHMM(25 * 60)).toBe('01:00');
    expect(fromHHMM('23:15')).toBe(23 * 60 + 15);
    expect(fromHHMM('')).toBeNull();
    expect(endAfter(22 * 60, 6 * 60)).toBe(30 * 60);
    expect(endAfter(7 * 60, 15 * 60)).toBe(15 * 60);
  });

  it('counts a week: shifts and paid hours (breaks out)', () => {
    expect(weekTotals([{ daysOfWeek: [1, 2, 3, 4, 5], startMinute: 420, endMinute: 900, facilityId: 'f', positionId: 'p', headcount: 2, unpaidBreakMinutes: 30 }])).toEqual({ shifts: 10, hours: 75 });
  });
});

describe('preference summary', () => {
  const p = { windows: [{ kind: 'PREFER' as const, daysOfWeek: [1, 2, 3, 4, 5], startMinute: 420, endMinute: 720, positionId: null, facilityId: 'f1' }, { kind: 'AVOID' as const, daysOfWeek: [0], startMinute: null, endMinute: null, positionId: null, facilityId: null }], maxWeeklyHours: 24, maxDaysPerWeek: 4 };
  it('reads at a glance, in English and French', () => {
    const e = preferenceSummary(p, tFor(en), 'en-CA', { facility: () => 'Parkinson' });
    expect(e[0]).toMatch(/^Prefers Mon–Fri .*Parkinson$/);
    expect(e[1]).toBe('Avoids Sun');
    expect(e.slice(2)).toEqual([expect.stringMatching(/^Up to 24/), 'Up to 4 days a week']);
    const f = preferenceSummary(p, tFor(fr), 'fr-CA');
    expect(f[0]).toMatch(/^Préfère /);
    expect(f[3]).toBe('Jusqu’à 4 jours par semaine');
  });
  it('nothing stated: nothing shown', () => {
    expect(preferenceSummary(null, tFor(en), 'en-CA')).toEqual([]);
  });
});
