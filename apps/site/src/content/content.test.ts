import { describe, expect, it } from 'vitest';
import { demoLink } from '../lib/site';
import { copy } from './copy';
import { ARTICLES } from './help';
import { legalDoc } from './legal';
import { ITEMS, LEVELS, PRIVATE, PUBLIC, SIZE, TERM_DISCOUNTS, UPFRONT_BONUS } from './pricing';

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

  it('demo links sign in as the role, in the reader’s language, with the way back to this site', () => {
    const u = new URL(demoLink('AQUATIC_SUPERVISOR', 'fr'));
    expect(u.pathname).toMatch(/\/login\/$/);
    expect(Object.fromEntries(u.searchParams)).toEqual({ as: 'AQUATIC_SUPERVISOR', lang: 'fr', back: 'http://localhost:3100/fr/' });
  });

  it('demo roles match the accounts the demo knows', () => {
    const known = ['STAFF', 'EMPLOYEE', 'AQUATIC_SUPERVISOR', 'HR_ADMIN', 'FRONT_DESK', 'UNION_STEWARD'];
    // The Dev console is FH's own tool: never on the public website or demo.
    for (const r of copy('en').demo.roles) expect(known).toContain(r.id);
  });
});

describe('prices', () => {
  it('match the app’s plan catalogue', async () => {
    const path = '../../../api/src/services/billing/catalog.ts';
    type Cat = { public: Record<string, { listCents: number; quoted: boolean; staffPerFacility: number | null; extraStaffCents: number; items: string[] }>; items: Record<string, { group: string; privateCents: number; publicCents: number }>; private: { coreCents: number; includedUsers: number; userCents: number }; sizePercent: Record<string, number> };
    const cat = ((await import(/* @vite-ignore */ path)) as { catalog: () => Cat }).catalog();
    for (const l of LEVELS) {
      expect(cat.public[l], l).toMatchObject({ listCents: PUBLIC[l].price * 100, quoted: PUBLIC[l].quoted, staffPerFacility: PUBLIC[l].staff, extraStaffCents: PUBLIC[l].extraStaff * 100 });
      expect([...cat.public[l]!.items].sort(), l).toEqual([...PUBLIC[l].items].sort());
    }
    expect(Object.keys(cat.items).sort()).toEqual(Object.keys(ITEMS).sort());
    for (const [k, v] of Object.entries(ITEMS)) expect(cat.items[k], k).toMatchObject({ group: v.group, privateCents: v.private * 100, publicCents: v.public * 100 });
    expect(cat.private).toEqual({ coreCents: PRIVATE.core * 100, includedUsers: PRIVATE.includedUsers, userCents: PRIVATE.perUser * 100 });
    expect(cat.sizePercent).toEqual({ 1: SIZE.seasonal, 2: SIZE.standard, 3: SIZE.major });
    // Term discounts match the app's.
    const termsPath = '../../../api/src/services/billing/terms.ts';
    const terms = (await import(/* @vite-ignore */ termsPath)) as { standardDiscount: (c: string, m: number | null) => number };
    for (const [months, pct] of Object.entries(TERM_DISCOUNTS)) {
      expect(terms.standardDiscount('MONTHLY', Number(months)), months).toBe(pct);
      expect(terms.standardDiscount('TERM', Number(months)), months).toBe(pct + UPFRONT_BONUS);
    }
    // Every option described on the page, in both languages.
    for (const lang of ['en', 'fr'] as const) expect(copy(lang).plans.items.map((m) => m.key).sort()).toEqual(Object.keys(ITEMS).sort());
  });
});
