import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';

/** Every notification type the API can send needs words in the bell. */
function apiSources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? apiSources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('notification text', () => {
  it('covers every notification type the API sends', () => {
    const types = new Set<string>();
    for (const file of apiSources(join(__dirname, '../../../api/src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\buserId[^}\n]*?\btype: '([a-z_]+)'/g)) types.add(m[1]!);
    }
    expect(types.size).toBeGreaterThan(10);
    const missing = [...types].filter((t) => !(t in en.notifications));
    expect(missing).toEqual([]);
  });
});
