import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { groupLabel, roleLabel } from './vocabulary';

/** A tiny t() over the real locale files, with i18next's defaultValue. */
const tOf = (dict: Record<string, unknown>) => (k: string, o?: Record<string, unknown>) => {
  const v = k.split('.').reduce<unknown>((x, p) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[p] : undefined), dict);
  return typeof v === 'string' ? v : String(o?.defaultValue ?? k);
};
const t = tOf(en);

describe('role and group names', () => {
  it('aquatic organizations keep the pool words; others get neutral or workplace words', () => {
    expect(roleLabel(t, 'en-CA', { profile: 'AQUATIC', roleLabels: {} }, 'STAFF')).toBe('Lifeguard / instructor');
    expect(roleLabel(t, 'en-CA', { profile: 'MUNICIPAL', roleLabels: {} }, 'STAFF')).toBe('Frontline staff');
    expect(roleLabel(t, 'en-CA', { profile: 'PRIVATE', roleLabels: {} }, 'AQUATIC_SUPERVISOR')).toBe('Manager');
    expect(roleLabel(tOf(fr), 'fr-CA', { profile: 'MUNICIPAL', roleLabels: {} }, 'HEAD_LIFEGUARD')).toBe('Chef d’équipe');
    // Before the profile is known (an older API): the words as they always were.
    expect(roleLabel(t, 'en-CA', null, 'STAFF')).toBe('Lifeguard / instructor');
  });

  it('the organization’s own names win, in each language', () => {
    const v = { profile: 'MUNICIPAL' as const, roleLabels: { STAFF: { en: 'Library assistant', fr: 'Aide-bibliothécaire' } } };
    expect(roleLabel(t, 'en-CA', v, 'STAFF')).toBe('Library assistant');
    expect(roleLabel(tOf(fr), 'fr-CA', v, 'STAFF')).toBe('Aide-bibliothécaire');
    expect(roleLabel(t, 'en-CA', v, 'FRONT_DESK')).toBe('Front desk');
  });

  it('"Pool deck" only where there are pools', () => {
    expect(groupLabel(t, { profile: 'AQUATIC', roleLabels: {} }, 'deck')).toBe('Pool deck');
    expect(groupLabel(t, { profile: 'MUNICIPAL', roleLabels: {} }, 'deck')).toBe('On site');
    expect(groupLabel(t, { profile: 'PRIVATE', roleLabels: {} }, 'manage')).toBe('Manage');
  });

  it('every role has a neutral and a workplace name in both languages', () => {
    for (const dict of [en, fr] as Array<{ roles: Record<string, string>; roleNames: Record<string, Record<string, string>> }>) {
      for (const profile of ['MUNICIPAL', 'PRIVATE']) expect(Object.keys(dict.roleNames[profile]!).sort()).toEqual(Object.keys(dict.roles).sort());
    }
  });
});
