import { describe, expect, it } from 'vitest';
import { demoLink } from '../lib/site';
import { copy } from './copy';
import { ARTICLES } from './help';
import { legalDoc } from './legal';

/** Same keys and array lengths in both languages, and no empty strings. */
function shape(v: unknown, path = ''): string[] {
  if (typeof v === 'string') return v.trim() ? [path] : [`${path} (empty)`];
  if (Array.isArray(v)) return [`${path}[${v.length}]`, ...v.flatMap((x, i) => shape(x, `${path}[${i}]`))];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => shape(x, `${path}.${k}`));
  return [path];
}

describe('site content', () => {
  it('French copy mirrors the English copy', () => {
    expect(shape(copy('fr'))).toEqual(shape(copy('en')));
  });

  it('every help article is complete in both languages', () => {
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
    for (const a of ARTICLES) {
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(shape(a.fr).filter((p) => !p.startsWith('.steps'))).toEqual(shape(a.en).filter((p) => !p.startsWith('.steps')));
      expect(a.fr.steps.length).toBe(a.en.steps.length);
    }
  });

  it('legal pages have the same sections in both languages', () => {
    for (const d of ['privacy', 'accessibility', 'terms'] as const) {
      expect(legalDoc(d, 'fr').sections.length).toBe(legalDoc(d, 'en').sections.length);
    }
  });

  it('demo links sign in as the role, in the reader’s language', () => {
    expect(demoLink('AQUATIC_SUPERVISOR', 'fr')).toMatch(/\/login\/\?as=AQUATIC_SUPERVISOR&lang=fr$/);
    expect(demoLink('DEV', 'en')).toMatch(/\/platform\/login\/\?demo=1&lang=en$/);
  });

  it('demo roles match the accounts the demo knows', () => {
    const known = ['STAFF', 'EMPLOYEE', 'AQUATIC_SUPERVISOR', 'HR_ADMIN', 'FRONT_DESK', 'UNION_STEWARD', 'DEV'];
    for (const r of copy('en').demo.roles) expect(known).toContain(r.id);
  });
});
