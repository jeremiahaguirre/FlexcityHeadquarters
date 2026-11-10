import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';

describe('payroll issues', () => {
  it('every code the API sends has English and French text', () => {
    const src = readFileSync(new URL('../../../api/src/services/payroll/issues.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('const EN'), src.indexOf('};', src.indexOf('const EN')));
    const codes = [...block.matchAll(/^  ([A-Z_]+):/gm)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(10);
    for (const c of codes) {
      expect((en.payrollIssues as Record<string, string>)[c], `en ${c}`).toBeTruthy();
      expect((fr.payrollIssues as Record<string, string>)[c], `fr ${c}`).toBeTruthy();
    }
  });
});
