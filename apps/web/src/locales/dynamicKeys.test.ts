import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en-CA.json';
import fr from './fr-CA.json';

// Keys the screens build from server lists (feature switches, journal accounts), so a
// missing one shows as raw text instead of failing a type check.
const api = (f: string) => readFileSync(join(__dirname, '../../../api/src', f), 'utf8');
const features = [...api('services/platform/features.ts').split('export const FEATURES = {')[1]!.split('\n};')[0]!.matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1]!);
const accounts = [...api('services/payroll/journal.ts').match(/ACCOUNT_KEYS = \[([^\]]+)\]/)![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
const get = (o: unknown, path: string) => path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);

describe('keys built from server lists', () => {
  it('found the lists', () => {
    expect(features.length).toBeGreaterThan(20);
    expect(accounts).toContain('ordersPayable');
  });
  for (const [name, dict] of [['en-CA', en], ['fr-CA', fr]] as const) {
    it(`${name}: every feature switch and journal account has a label`, () => {
      const missing = [
        ...features.flatMap((k) => [`platform.features.${k}.name`, `platform.features.${k}.help`]),
        ...accounts.map((k) => `accounting.keys.${k}`),
        'platform.featureGroups.other',
      ].filter((k) => typeof get(dict, k) !== 'string');
      expect(missing).toEqual([]);
    });
  }
});
