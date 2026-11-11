import { describe, expect, it } from 'vitest';
import * as api from '../../../api/src/services/trust/detailKeys';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { DETAIL_KINDS, DETAIL_VALUES, RLS_PROBLEMS, SECRETISH, detailRows, humanize } from './trustDetails';

type Dict = Record<string, unknown>;
const at = (o: Dict, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Dict)[k] : undefined), o);
const fill = (s: string, opts?: Record<string, unknown>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? ''));
const tOf = (dict: Dict) => (key: string, opts?: Record<string, unknown>) => {
  const v = at(dict, key);
  return typeof v === 'string' ? fill(v, opts) : key;
};

describe('Trust test details', () => {
  it('mirrors the details the API monitors can return', () => {
    expect(DETAIL_KINDS).toEqual(api.MONITOR_DETAILS);
    expect(DETAIL_VALUES).toEqual(api.DETAIL_VALUES);
    expect(RLS_PROBLEMS).toEqual(api.RLS_PROBLEMS);
    expect(SECRETISH.source).toBe(api.SECRETISH.source);
  });

  it.each([['en-CA', en], ['fr-CA', fr]] as const)('labels every detail key, value and problem in %s', (_, dict) => {
    const missing: string[] = [];
    const need = (k: string) => {
      const v = at(dict as Dict, k);
      if (typeof v !== 'string' || !v.trim()) missing.push(k);
    };
    need('trust.testDetails.heading');
    for (const k of api.MONITOR_DETAIL_KEYS) need(`trust.testDetails.keys.${k}`);
    for (const [k, vs] of Object.entries(api.DETAIL_VALUES)) for (const v of vs) need(`trust.testDetails.values.${k}.${v}`);
    for (const id of Object.values(api.RLS_PROBLEMS)) need(`trust.testDetails.rls.${id}`);
    expect(missing).toEqual([]);
  });

  it('has no detail key the scrubber would hide', () => {
    expect(api.MONITOR_DETAIL_KEYS.filter((k) => api.SECRETISH.test(k))).toEqual([]);
  });

  it('formats values for the language', () => {
    const t = tOf(fr as Dict);
    const rows = detailRows({
      configured: false,
      tablesChecked: 1234,
      workerAgeS: 125,
      lastOkAt: '2026-11-10T14:05:00.000Z',
      provider: 'local',
      problems: ['Shift: not forced', 'Odd: something new'],
      unpublished: [{ en: 'Privacy policy', fr: 'Politique de confidentialité' }, { en: 'Only English' }],
      summaryFr: 'hidden',
      lastSeenAt: 'x',
      apiToken: 'abc',
      sentryDsn: 'https://secret',
    }, t, 'fr-CA');
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rows.map((r) => r.key)).toEqual(['configured', 'tablesChecked', 'workerAgeS', 'lastOkAt', 'provider', 'problems', 'unpublished', 'lastSeenAt']);
    expect(by.configured).toMatchObject({ label: 'Configuré', value: 'Non' });
    expect(by.tablesChecked!.value).toMatch(/^1\s234$/);
    expect(by.workerAgeS!.value).toMatch(/^2\sminutes$/);
    expect(by.lastOkAt!.value).toMatch(/2026/);
    expect(by.lastOkAt!.value).toMatch(/nov/);
    expect(by.provider!.value).toBe('Clé de développement locale');
    expect(by.problems!.value).toEqual(['Shift : non forcée', 'Odd: something new']);
    expect(by.unpublished!.value).toEqual(['Politique de confidentialité', 'Only English']);
    expect(by.lastSeenAt!.label).toBe('Last seen at');
  });

  it('formats in English too', () => {
    const rows = detailRows({ enforced: true, oldestAgeS: 7200, at: '2026-11-10T14:05:00.000Z' }, tOf(en as Dict), 'en-CA');
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Passkey required', 'Yes'],
      ['Oldest message waiting', '2 hours'],
      ['Recorded', expect.stringMatching(/Nov/)],
    ]);
  });

  it('humanizes unknown keys', () => {
    expect(humanize('acknowledgementsMissing')).toBe('Acknowledgements missing');
    expect(humanize('last_ok_at')).toBe('Last ok at');
  });
});
