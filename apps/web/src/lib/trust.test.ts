import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { createI18n } from './i18n';
import { compareValues, heatCells, linePath, pick, riskLevel, scoreOf, timelinePos, type OverviewRisk } from './trust';

const risk = (over: Partial<OverviewRisk>): OverviewRisk => ({ id: 'r', ref: 'R-1', title: 'T', titleFr: null, likelihood: 3, impact: 3, residualLikelihood: 1, residualImpact: 2, score: 2, ...over });

describe('trust helpers', () => {
  it('lays the heat map out with impact 5 on top and counts risks per cell', () => {
    const cells = heatCells([risk({ id: 'a' }), risk({ id: 'b', residualLikelihood: 5, residualImpact: 5 })], 'residual');
    expect(cells).toHaveLength(25);
    expect(cells[0]).toMatchObject({ likelihood: 1, impact: 5 });
    expect(cells[4]!.risks.map((r) => r.id)).toEqual(['b']);
    expect(cells.find((c) => c.likelihood === 1 && c.impact === 2)!.risks).toHaveLength(1);
    expect(heatCells([risk({})], 'inherent').find((c) => c.likelihood === 3 && c.impact === 3)!.risks).toHaveLength(1);
  });

  it('recolours by the appetite', () => {
    expect(riskLevel(12, 12)).toBe('high');
    expect(riskLevel(12, 16)).toBe('medium');
    expect(riskLevel(3, 16)).toBe('low');
  });

  it('draws lines inside the box', () => {
    expect(linePath([], 100, 20)).toBe('');
    expect(linePath([0, 10], 100, 20, 10)).toBe('M2.0,18.0 L98.0,2.0');
  });

  it('places timeline items and pins overdue ones at the start', () => {
    const start = Date.UTC(2026, 10, 1);
    expect(timelinePos(new Date(start + 45 * 86_400_000).toISOString(), start, 90)).toBeCloseTo(0.5);
    expect(timelinePos(new Date(start - 86_400_000).toISOString(), start, 90)).toBe(0);
    expect(timelinePos(new Date(start + 200 * 86_400_000).toISOString(), start, 90)).toBe(1);
  });

  it('scores like the API (needs evidence counts half, not applicable left out)', () => {
    expect(scoreOf({ PASSING: 2, NEEDS_EVIDENCE: 2, FAILING: 0, NOT_APPLICABLE: 5 })).toBe(75);
    expect(scoreOf({})).toBe(0);
  });

  it('sorts dates, numbers and text, empties last', () => {
    const v = ['2026-12-01', null, '2026-01-05'].sort((a, b) => compareValues(a, b, 'en'));
    expect(v).toEqual(['2026-01-05', '2026-12-01', null]);
    expect([10, 2].sort((a, b) => compareValues(a, b, 'en'))).toEqual([2, 10]);
    expect(['R-10', 'R-2'].sort((a, b) => compareValues(a, b, 'en'))).toEqual(['R-2', 'R-10']);
  });

  it('picks the French field when there is one', () => {
    expect(pick({ title: 'Hello', titleFr: 'Bonjour' }, 'title', 'fr-CA')).toBe('Bonjour');
    expect(pick({ title: 'Hello', titleFr: null }, 'title', 'fr-CA')).toBe('Hello');
    expect(pick({ title: 'Hello', titleFr: 'Bonjour' }, 'title', 'en-CA')).toBe('Hello');
  });

  it('has Trust labels in both languages for every status, kind and section', () => {
    for (const dict of [en, fr] as const) {
      const tr = dict.trust as unknown as Record<string, Record<string, unknown>>;
      expect(Object.keys(tr.section!)).toHaveLength(11);
      for (const s of ['PASSING', 'FAILING', 'NEEDS_EVIDENCE', 'NOT_APPLICABLE']) expect(typeof tr.status![s]).toBe('string');
      for (const s of ['PASS', 'FAIL', 'WARN', 'ERROR', 'NONE']) expect(typeof tr.testStatus![s]).toBe('string');
    }
    expect(JSON.stringify(fr.trust)).not.toMatch(/'/);
  });

  it('agrees counts in French and English: one policy, one admin, one gap', () => {
    const f = createI18n('fr-CA');
    const e = createI18n('en-CA');
    const ack = (t: typeof f.t, p: number, a: number) => t('trust.ackProgress', { policies: t('trust.ackPolicies', { count: p }), admins: t('trust.ackAdmins', { count: a }) });
    expect(ack(f.t, 1, 1)).toBe('Acceptations des politiques (1 politique publiée × 1 administrateur)');
    expect(ack(f.t, 9, 3)).toBe('Acceptations des politiques (9 politiques publiées × 3 administrateurs)');
    expect(ack(e.t, 1, 2)).toBe('Policy acknowledgements (1 published policy × 2 admins)');
    // Several counts in one line: label, then number, so nothing has to agree ("1 lacunes", "3 élevé").
    expect(f.t('trust.frameworks.counts', { met: 1, partial: 0, gaps: 1, na: 0 })).toBe('Satisfaites : 1 · en partie : 0 · lacunes : 1 · s.o. : 0');
    expect(e.t('trust.frameworks.counts', { met: 1, partial: 0, gaps: 1, na: 0 })).toBe('Met 1 · partly met 0 · gaps 1 · n/a 0');
    expect(f.t('trust.vendorDist', { high: 3, medium: 1, low: 0 })).toBe('Fournisseurs par risque : élevé 3, moyen 1, faible 0');
  });

  it('writes no French count in front of a noun outside a plural key', () => {
    // "{{n}} word" in a sentence that isn't a _one/_other pair would read "1 comptes" for one of the counts.
    const flat = (o: Record<string, unknown>, p = ''): Array<[string, string]> => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)] as [string, string]]));
    const words = new Set(['name', 'date', 'status', 'version', 'ago', 'table', 'email', 'score', 'next', 'policies', 'admins', 'inherent', 'residual', 'appetite', 'likelihood', 'impact']);
    const bad = flat(fr.trust as Record<string, unknown>)
      .filter(([k]) => !/_(one|other|many)$/.test(k) && k !== 'metOf')
      .filter(([, v]) => [...v.matchAll(/\{\{(\w+)\}\} ([a-zà-ÿ]+)/g)].some((m) => !words.has(m[1]!) && m[2] !== 'sur'));
    expect(bad).toEqual([]);
  });
});
