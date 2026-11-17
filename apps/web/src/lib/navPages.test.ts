import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU } from '../../../api/src/auth/menu';
import { NAV } from './nav';

const APP = join(__dirname, '..', 'app');
/** Route groups such as (app) and (platform) don't appear in the address, so a page can sit in any of them. */
const GROUPS = ['', ...readdirSync(APP).filter((d) => /^\(.+\)$/.test(d))];

function pageFor(href: string): string | undefined {
  return GROUPS.map((g) => join(APP, g, ...href.split('/').filter(Boolean), 'page.tsx')).find((f) => existsSync(f));
}

/**
 * True when git would leave the file out of a commit (a too-broad .gitignore rule once hid the coverage screen).
 * check-ignore skips files git already tracks; that's fine, since a committed page ships.
 * Any other failure (no git, not a work tree) fails the test instead of passing it unchecked.
 */
function ignoredByGit(file: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: APP, stdio: 'ignore' });
    return true; // exit 0: ignored
  } catch (e) {
    if ((e as { status?: number }).status === 1) return false; // exit 1: not ignored
    throw e;
  }
}

describe('every menu link has a page that ships', () => {
  const hrefs = [...new Set([...NAV.map((n) => n.href), ...MENU.map((m) => m.href)])];

  it.each(hrefs)('%s', (href) => {
    const file = pageFor(href);
    expect(file, `no page.tsx for ${href}`).toBeDefined();
    expect(ignoredByGit(file!), `${href}: page.tsx is matched by .gitignore, so it is never committed`).toBe(false);
  });
});
