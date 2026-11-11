import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The website deploys on its own (apps/site is its root), so it keeps copies of
 * the app's logo and logo motion. These must stay identical so the brand moves
 * the same way everywhere.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string) => readFileSync(here(p), 'utf8');
const motion = (css: string) => css.slice(css.indexOf('/* @logo-motion start'), css.indexOf('/* @logo-motion end */'));

describe('logo matches the app', () => {
  it('uses the same mark', () => expect(read('./Logo.tsx')).toBe(read('../../../web/src/components/Logo.tsx')));
  it('replays the same way in the header', () => expect(read('./LiveLogo.tsx')).toBe(read('../../../web/src/components/LiveLogo.tsx')));
  it('moves the same way', () => {
    const site = motion(read('../app/globals.css'));
    expect(site.length).toBeGreaterThan(500);
    expect(site).toBe(motion(read('../../../web/src/app/globals.css')));
  });
});
