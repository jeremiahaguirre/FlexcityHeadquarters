import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ops/monitoring/alerts.yml may only name metrics the API really exports, and every rule must say
 * how bad it is and point at a section of the runbook that exists.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const rulesText = readFileSync(join(root, 'ops/monitoring/alerts.yml'), 'utf8');
const runbook = readFileSync(join(root, 'docs/MONITORING.md'), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'generated') return []; // Prisma's generated client
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [readFileSync(p, 'utf8')] : [];
  });
}
const exported = new Set(sources(join(root, 'apps/api/src')).flatMap((s) => [...s.matchAll(/'(fh_[a-z_]+)'/g)].map((m) => m[1]!)));
const anchors = new Set([...runbook.matchAll(/^#{2,4} (.+)$/gm)].map((m) => m[1]!.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')));

interface Rule { alert: string; expr: string; severity?: string; summary?: string; runbook?: string }
/** Reads the rules without a YAML library: each rule starts at "- alert:"; its fields are the keys under it. */
const rules: Rule[] = rulesText.split(/\n\s*- alert: /).slice(1).map((block) => {
  const field = (k: string) => block.match(new RegExp(`^\\s*${k}: "?([^"\\n]+)"?`, 'm'))?.[1]?.trim();
  const expr = block.match(/^\s*expr: (\|\n(?:\s{10,}.*\n?)+|.+)$/m)?.[1]?.trim() ?? '';
  return { alert: block.split('\n')[0]!.trim(), expr, severity: block.match(/severity: (\w+)/)?.[1], summary: field('summary'), runbook: field('runbook') };
});

describe('alert rules', () => {
  it('parse, and each has a name, an expression, a severity, a summary and a runbook link', () => {
    expect(rules.length).toBeGreaterThan(8);
    for (const r of rules) {
      expect(r.alert, JSON.stringify(r)).toBeTruthy();
      expect(r.expr, r.alert).toBeTruthy();
      expect(['page', 'ticket'], r.alert).toContain(r.severity);
      expect(r.summary, r.alert).toBeTruthy();
      expect(r.runbook, r.alert).toMatch(/^docs\/MONITORING\.md#/);
    }
  });
  it('only name metrics the API exports', () => {
    const used = new Set([...rulesText.matchAll(/\b(fh_[a-z_]+)/g)].map((m) => m[1]!.replace(/_(bucket|sum|count)$/, '')));
    for (const m of used) expect(exported, m).toContain(m);
  });
  it('link to runbook sections that exist', () => {
    for (const r of rules) expect(anchors, `${r.alert} → ${r.runbook}`).toContain(r.runbook!.split('#')[1]);
  });
});

describe('dashboard', () => {
  it('parses and only charts metrics the API exports', () => {
    const d = JSON.parse(readFileSync(join(root, 'ops/monitoring/dashboard.json'), 'utf8')) as { panels: Array<{ title: string; targets: Array<{ expr: string }> }> };
    expect(d.panels.length).toBeGreaterThan(5);
    for (const p of d.panels) for (const t of p.targets) for (const m of t.expr.matchAll(/\b(fh_[a-z_]+)/g)) expect(exported, `${p.title}: ${m[1]}`).toContain(m[1]!.replace(/_(bucket|sum|count)$/, ''));
  });
});
