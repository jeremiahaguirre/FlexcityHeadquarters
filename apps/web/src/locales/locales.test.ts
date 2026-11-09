import { describe, expect, it } from 'vitest';
import en from './en-CA.json';
import fr from './fr-CA.json';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('translations', () => {
  it('French and English have exactly the same keys', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });
  it('no French string is left empty', () => {
    const flat = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === 'object' ? flat(v) : [v as string]));
    expect(flat(fr).every((s) => s.trim().length > 0)).toBe(true);
  });
});
