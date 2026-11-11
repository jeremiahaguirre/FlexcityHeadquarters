import { describe, expect, it } from 'vitest';
import { eventEffect, eventEffectValues, reasonText } from './forecast';
import { createI18n } from './i18n';

const en = createI18n('en-CA');
const fr = createI18n('fr-CA');
const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('forecast reasons', () => {
  it('says why a day moved, in English and French', () => {
    const hot = { kind: 'weather' as const, bucket: 'hot' as const, condition: 'sunny' as const, high: 31, pct: 18, source: 'default' as const };
    expect(norm(reasonText(hot, en.t, 'en-CA'))).toBe('+18% hot and sunny (31 °C)');
    expect(norm(reasonText(hot, fr.t, 'fr-CA'))).toBe('+18 % chaud et ensoleillé (31 °C)');
    const rain = { kind: 'weather' as const, bucket: 'rain' as const, condition: 'rain' as const, high: 17, pct: -35, source: 'learned' as const, days: 9 };
    expect(norm(reasonText(rain, en.t, 'en-CA'))).toBe('-35% rain (learned from 9 days here)');
    expect(norm(reasonText({ kind: 'weather', bucket: 'mild', condition: 'partly', high: 18, pct: 0, source: 'default' }, en.t, 'en-CA'))).toBe('No change expected: mild (18 °C)');
    expect(norm(reasonText({ kind: 'holiday', name: 'Canada Day', nameFr: 'Fête du Canada', pct: 15 }, fr.t, 'fr-CA'))).toBe('+15 % Fête du Canada (jour férié)');
    expect(norm(reasonText({ kind: 'holiday', name: 'Christmas Day', nameFr: 'Noël', pct: 10, observed: true }, fr.t, 'fr-CA'))).toBe('+10 % Noël (jour férié, observé)');
    expect(reasonText({ kind: 'event', id: 'e', name: 'Swim meet', pct: null, extra: 40, startMinute: 780, endMinute: 900, cityWide: false, notes: null }, en.t, 'en-CA')).toMatch(/^\+40 people Swim meet \(1\s?p\.m\.–3\s?p\.m\.\)$/);
    expect(reasonText({ kind: 'school', name: 'Spring break' }, fr.t, 'fr-CA')).toBe('Pas d’école : Spring break');
  });
});

describe('special event effect', () => {
  it('keeps extra people and a percentage together when an event has both', () => {
    const both = { extraPeople: 200, percent: 25 };
    expect(eventEffect(both)).toBe('both');
    expect(eventEffectValues(eventEffect(both), 200, 25)).toEqual(both);
  });
  it('opens on the one an event uses, and clears the other', () => {
    expect(eventEffect('new')).toBe('extra');
    expect(eventEffect({ extraPeople: null, percent: -20 })).toBe('percent');
    expect(eventEffect({ extraPeople: 50, percent: null })).toBe('extra');
    expect(eventEffectValues('percent', 50, 10)).toEqual({ extraPeople: null, percent: 10 });
    expect(eventEffectValues('extra', 50, 10)).toEqual({ extraPeople: 50, percent: null });
  });
});
