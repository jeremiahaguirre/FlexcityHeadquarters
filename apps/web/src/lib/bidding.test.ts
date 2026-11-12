import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { awardReason, itemWhen, move, ordinal, outcomeText } from './bidding';

const tFor = (dict: unknown) => (key: string, o: Record<string, unknown> = {}): string => {
  const get = (k: string) => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], dict);
  const raw = get(key);
  if (typeof raw !== 'string') return typeof o.defaultValue === 'string' ? o.defaultValue : key;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(o[k] ?? ''));
};

describe('bidding helpers', () => {
  it('moves a choice up or down, never past the ends', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
  it('ordinals in English and French', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map((n) => ordinal(n, 'en-CA'))).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    expect([1, 2].map((n) => ordinal(n, 'fr-CA'))).toEqual(['1er', '2e']);
  });
  it('explains every outcome, with the rule when someone couldn’t work it', () => {
    const t = tFor(en);
    expect(outcomeText({ itemId: 'x', rank: 1, result: 'TAKEN_BY_SENIOR' }, t)).toBe('A more senior colleague chose it');
    expect(outcomeText({ itemId: 'x', rank: 1, result: 'NOT_ELIGIBLE', code: 'MISSING_CERTIFICATION' }, t)).toBe('Couldn’t be awarded: A required certification is missing.');
    expect(outcomeText({ itemId: 'x', rank: 1, result: 'NOT_ELIGIBLE', code: 'OVERTIME' }, t)).toContain('overtime');
    expect(outcomeText({ itemId: 'x', rank: 1, result: 'NOT_ELIGIBLE', code: 'SOMETHING_NEW' }, tFor(fr))).toContain('règle');
  });
  it('award reasons follow the round’s award order', () => {
    expect(awardReason({ choiceRank: 2, pass: 1 }, 'ROUND_ROBIN', tFor(en), 'en-CA')).toBe('Choice #2, pass 1');
    expect(awardReason({ choiceRank: 2, pass: 2 }, 'SENIOR_FIRST', tFor(en), 'en-CA')).toBe('Choice #2, their 2nd award');
    expect(awardReason({ choiceRank: 1, pass: 1 }, 'SENIOR_FIRST', tFor(fr), 'fr-CA')).toBe('Choix no 1, attribution 1 de son tour');
    expect(awardReason({ choiceRank: null, pass: 1 }, 'ROUND_ROBIN', tFor(en), 'en-CA')).toBe('Choice #—, pass 1');
  });
  it('a line reads as its days and times', () => {
    expect(itemWhen({ id: 'i', facility: 'F', position: { id: 'p', name: 'Lifeguard', nameFr: null }, shifts: 20, localStartsAt: '2027-07-05T07:00:00-07:00', localEndsAt: '2027-08-31T15:00:00-07:00', meta: { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 420, endMinute: 900 } }, 'en-CA', 'Every day')).toMatch(/^Mon–Fri 7:00/);
  });
});
