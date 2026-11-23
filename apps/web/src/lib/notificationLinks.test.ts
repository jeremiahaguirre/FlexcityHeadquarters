import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every link a notification carries opens a page that exists (a front-desk page once linked to a missing /notifications). */
const API = join(__dirname, '../../../api/src');
const APP = join(__dirname, '..', 'app');
const GROUPS = ['', ...readdirSync(APP).filter((d) => /^\(.+\)$/.test(d))];
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (f === 'generated' ? [] : statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));

const links = files(API).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/link: ['`](\/[^'`$?#]*)/g)].map((m) => ({ path: m[1]!.replace(/\/$/, '') || '/', file: relative(API, f) })));
const page = (path: string) => GROUPS.some((g) => existsSync(join(APP, g, ...path.split('/').filter(Boolean), 'page.tsx')));

describe('notification links', () => {
  it('found the links', () => {
    expect(links.length).toBeGreaterThan(40);
  });
  it('each opens a page that ships', () => {
    expect(links.filter((l) => !page(l.path)).map((l) => `${l.path} (${l.file})`)).toEqual([]);
  });
});
