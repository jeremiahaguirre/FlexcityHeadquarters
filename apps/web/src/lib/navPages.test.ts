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

/** True when git would leave the file out of a commit (a too-broad .gitignore rule once hid the coverage screen). */
function ignoredByGit(file: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: APP, stdio: 'ignore' });
    return true; // exit 0: ignored
  } catch {
    return false; // exit 1: not ignored
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
