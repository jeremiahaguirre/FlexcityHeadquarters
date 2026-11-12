import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { type MySurvey, exitStarterQuestions, surveyToNudge } from './surveys';

const tFor = (dict: unknown) => (key: string): string => {
  const raw = key.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], dict);
  return typeof raw === 'string' ? raw : key;
};
const s = (id: string, closesAt: string, responded = false): MySurvey => ({ id, kind: 'PULSE', from: 'hr', title: id, intro: null, anonymous: true, minGroup: 5, closesAt, responded, questions: [] });
const now = Date.parse('2026-11-12T12:00:00Z');

describe('the survey card on Today', () => {
  it('shows the open, unanswered survey closing soonest', () => {
    const list = [s('later', '2026-11-30T23:59:00Z'), s('soon', '2026-11-20T23:59:00Z'), s('done', '2026-11-14T23:59:00Z', true)];
    expect(surveyToNudge(list, [], now)?.id).toBe('soon');
  });
  it('nothing when none is waiting, all are answered or closed, or the person hid them this session', () => {
    expect(surveyToNudge(null, [], now)).toBeNull();
    expect(surveyToNudge([], [], now)).toBeNull();
    expect(surveyToNudge([s('a', '2026-11-20T00:00:00Z', true)], [], now)).toBeNull();
    expect(surveyToNudge([s('old', '2026-11-11T00:00:00Z')], [], now)).toBeNull();
    expect(surveyToNudge([s('a', '2026-11-20T00:00:00Z'), s('b', '2026-11-25T00:00:00Z')], ['a'], now)?.id).toBe('b');
    expect(surveyToNudge([s('a', '2026-11-20T00:00:00Z')], ['a'], now)).toBeNull();
  });
});

describe('exit survey starting questions', () => {
  it('every question and option has text in English and French', () => {
    for (const dict of [en, fr]) {
      const qs = exitStarterQuestions(tFor(dict));
      expect(qs.map((q) => q.type)).toEqual(['RATING', 'CHOICE', 'TEXT', 'CHOICE']);
      for (const q of qs) {
        expect(q.text).not.toMatch(/^surveys\./);
        for (const o of q.options ?? []) expect(o).not.toMatch(/^surveys\./);
      }
    }
  });
});
