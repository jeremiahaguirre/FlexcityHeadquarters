/**
 * SECURITY.md is FH's security decision ledger (ASVS v5.0.0 V*.1 documentation items). These checks
 * keep it true as the code moves: every path it cites exists (and every cited line is inside its
 * file), every route file is in the 2.6 route inventory, and every Terraform log group is in the 2.11
 * logging inventory. Each failure case is proved below on a changed copy of the ledger.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../../src/auth/permissions.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const LEDGER = read('SECURITY.md');

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.terraform')) continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...walk(p, keep));
    else if (keep(name)) out.push(p);
  }
  return out;
}

/** The text of one `###` section (up to the next heading of the same or a higher level). */
function section(md: string, number: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`### ${number} `));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

const firstH2 = (md: string) => md.split('\n').find((l) => l.startsWith('## '))?.slice(3).trim();

const PATH = /^((?:apps|ops|docs|brand|\.github)\/[^\s:`]+|[A-Z][A-Z-]*\.md|Dockerfile)(?::(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*))?$/;

/** Every repository path the ledger cites, in backticks (`path` or `path:12-14,20`) or as a link target. */
function citations(md: string): Array<{ path: string; lines: number[] }> {
  const out: Array<{ path: string; lines: number[] }> = [];
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const c = PATH.exec(m[1]!);
    if (c) out.push({ path: c[1]!, lines: (c[2] ?? '').split(/[,-]/).filter(Boolean).map(Number) });
  }
  for (const m of md.matchAll(/\]\(((?:apps|ops|docs|brand|\.github)\/[^)#\s]+|[A-Z][A-Z-]*\.md)(?:#[^)]*)?\)/g)) out.push({ path: m[1]!, lines: [] });
  return out;
}

/** A path in backticks that is written short (`lib/files.ts`), so the checks below can't see it. */
const SHORT_PATH = /^[\w@.-]+(?:\/[\w@.[\]-]+)+\.(?:ts|tsx|js|mjs|cjs|sql|md|tf|hcl|yml|yaml|json|prisma)(?::[\d,-]+)?$/;
function shortPaths(md: string): string[] {
  return [...md.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!).filter((t) => SHORT_PATH.test(t) && !PATH.test(t));
}

/** Citations that point nowhere: a missing file, or a line past its end. */
function brokenCitations(md: string, exists = (p: string) => existsSync(join(ROOT, p)), lineCount = (p: string) => read(p).split('\n').length): string[] {
  const bad: string[] = [];
  for (const { path, lines } of citations(md)) {
    if (!exists(path)) bad.push(`${path} (missing)`);
    else if (lines.length && Math.max(...lines) > lineCount(path)) bad.push(`${path}:${Math.max(...lines)} (past the end)`);
  }
  return [...new Set(bad)];
}

/** The 2.6 table row for a route file (the line that starts with its path), if any. */
const routeRow = (md: string, f: string) => section(md, '2.6').split('\n').find((l) => l.startsWith(`| \`${f}\` |`));

/** Route files the 2.6 inventory has no row for (being named elsewhere in 2.6 doesn't count). */
function routesMissing(md: string, routeFiles: string[]): string[] {
  return routeFiles.filter((f) => !routeRow(md, f));
}

/** Permissions a route file names in its source that its 2.6 row leaves out, as "file: permission". */
function permissionsMissing(md: string, files: Array<{ file: string; source: string }>): string[] {
  const known = new Set<string>(PERMISSIONS);
  const out: string[] = [];
  for (const { file, source } of files) {
    const row = routeRow(md, file);
    if (!row) continue;
    const named = new Set([...source.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]!).filter((p) => known.has(p)));
    // A whole-word match without a regular expression: the permission, not part of a longer name.
    const isWord = (c: string | undefined) => c !== undefined && /[a-z_.]/.test(c);
    const inRow = (p: string) => {
      for (let i = row.indexOf(p); i >= 0; i = row.indexOf(p, i + 1)) if (!isWord(row[i - 1]) && !isWord(row[i + p.length])) return true;
      return false;
    };
    for (const p of named) if (!inRow(p)) out.push(`${file}: ${p}`);
  }
  return out;
}

/** Names of the Terraform log groups declared in some .tf sources. */
const logGroups = (tf: string[]) => tf.flatMap((t) => [...t.matchAll(/resource\s+"aws_cloudwatch_log_group"\s+"([\w-]+)"/g)].map((m) => m[1]!));

/** Terraform log groups the 2.11 inventory doesn't name (as aws_cloudwatch_log_group.<name>). */
function logGroupsMissing(md: string, tf: string[]): string[] {
  const inv = section(md, '2.11');
  return logGroups(tf).filter((n) => !inv.includes(`aws_cloudwatch_log_group.${n}`));
}

const ROUTE_FILES = walk('apps/api/src/routes', (n) => n.endsWith('.ts')).map((p) => relative(ROOT, join(ROOT, p)).split('\\').join('/'));
const TERRAFORM = walk('ops/terraform', (n) => n.endsWith('.tf')).map(read);
const ROUTE_SOURCES = ROUTE_FILES.map((file) => ({ file, source: read(file) }));

describe('SECURITY.md is the security decision ledger', () => {
  it('keeps the reporting policy first', () => {
    expect(firstH2(LEDGER)).toBe('Reporting a vulnerability');
  });

  it('has the directives, sections 2.1 to 2.11, the deviations and the pre-merge gate', () => {
    for (const h of ['## 1. Directives', '## 2. Security decision ledger', '## 3. Deviations and open decisions', '## 4. Pre-merge gate']) expect(LEDGER).toContain(`\n${h}\n`);
    for (let n = 1; n <= 11; n++) expect(section(LEDGER, `2.${n}`), `section 2.${n}`).not.toBe('');
  });

  it('is what CLAUDE.md points every change to', () => {
    expect(read('CLAUDE.md')).toMatch(/\]\(SECURITY\.md\)/);
  });

  it('cites only paths and lines that exist, every path written from the repository root', () => {
    expect(citations(LEDGER).length).toBeGreaterThan(100);
    expect(brokenCitations(LEDGER)).toEqual([]);
    expect(shortPaths(LEDGER)).toEqual([]);
  });

  it('lists every route file in 2.6', () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(80);
    expect(routesMissing(LEDGER, ROUTE_FILES)).toEqual([]);
  });

  it('names in each 2.6 row every permission its route file names', () => {
    expect(permissionsMissing(LEDGER, ROUTE_SOURCES)).toEqual([]);
  });

  it('lists every Terraform log group in 2.11', () => {
    expect(logGroups(TERRAFORM)).toEqual(expect.arrayContaining(['svc', 'postgresql']));
    expect(logGroupsMissing(LEDGER, TERRAFORM)).toEqual([]);
  });
});

describe('the ledger checks catch drift (abuse cases, on changed copies of the ledger)', () => {
  it('a different first section fails', () => {
    const moved = LEDGER.replace('## Reporting a vulnerability', '## Reporting').replace('## How to read this file', '## Reporting a vulnerability');
    expect(firstH2(moved)).not.toBe('Reporting a vulnerability');
  });

  it('a section that goes missing fails', () => {
    expect(section(LEDGER.replace('### 2.11 Security logging', '### Logging'), '2.11')).toBe('');
  });

  it('a cited file that does not exist fails', () => {
    const fake = LEDGER.replace('`apps/api/src/lib/files.ts:11-20`', '`apps/api/src/lib/uploadsGone.ts:11-20`');
    expect(fake).not.toBe(LEDGER);
    expect(brokenCitations(fake)).toEqual(['apps/api/src/lib/uploadsGone.ts (missing)']);
  });

  it('a cited line past the end of its file fails', () => {
    const fake = LEDGER.replace('`apps/api/src/lib/files.ts:11-20`', '`apps/api/src/lib/files.ts:11-9999`');
    expect(brokenCitations(fake)).toEqual(['apps/api/src/lib/files.ts:9999 (past the end)']);
  });

  it('a link to a document that does not exist fails', () => {
    const fake = LEDGER.replace('](docs/PUBLIC-API.md)', '](docs/NO-SUCH-DOC.md)');
    expect(brokenCitations(fake)).toEqual(['docs/NO-SUCH-DOC.md (missing)']);
  });

  it('a route file left out of 2.6 fails, and so does a new one nobody added', () => {
    const fake = LEDGER.split('\n').filter((l) => !l.startsWith('| `apps/api/src/routes/deck.ts`')).join('\n');
    expect(routesMissing(fake, ROUTE_FILES)).toEqual(['apps/api/src/routes/deck.ts']);
    expect(routesMissing(LEDGER, [...ROUTE_FILES, 'apps/api/src/routes/newFeature.ts'])).toEqual(['apps/api/src/routes/newFeature.ts']);
  });

  it('a route row removed while the file is still named elsewhere in 2.6 fails', () => {
    const fake = LEDGER.split('\n').filter((l) => !l.startsWith('| `apps/api/src/routes/serializers.ts`')).join('\n');
    expect(section(fake, '2.6')).toContain('`apps/api/src/routes/serializers.ts`');
    expect(routesMissing(fake, ROUTE_FILES)).toEqual(['apps/api/src/routes/serializers.ts']);
  });

  it('a permission left out of a route’s row fails, and so does one a route starts checking', () => {
    const fake = LEDGER.replace('| org | lessons.plan, or members.manage where either may (`anyOf`) |', '| org | lessons.plan |');
    expect(fake).not.toBe(LEDGER);
    expect(permissionsMissing(fake, ROUTE_SOURCES)).toEqual(['apps/api/src/routes/programs.ts: members.manage']);
    const grown = ROUTE_SOURCES.map((r) => (r.file === 'apps/api/src/routes/deck.ts' ? { ...r, source: `${r.source}\nrequirePermission('payroll.approve');` } : r));
    expect(permissionsMissing(LEDGER, grown)).toEqual(['apps/api/src/routes/deck.ts: payroll.approve']);
  });

  it('a path written short is refused', () => {
    const fake = LEDGER.replace('`apps/api/src/lib/egress.ts`', '`lib/egress.ts`');
    expect(fake).not.toBe(LEDGER);
    expect(shortPaths(fake)).toEqual(['lib/egress.ts']);
  });

  it('a route named only outside 2.6 still fails', () => {
    const fake = LEDGER.split('\n').filter((l) => !l.startsWith('| `apps/api/src/routes/kiosk.ts`')).join('\n');
    expect(fake).toContain('`apps/api/src/routes/kiosk.ts:'); // cited in 2.4 and 2.5
    expect(routesMissing(fake, ROUTE_FILES)).toEqual(['apps/api/src/routes/kiosk.ts']);
  });

  it('a Terraform log group left out of 2.11 fails, and so does a new one', () => {
    const fake = LEDGER.replace('`aws_cloudwatch_log_group.postgresql`', 'the database log group');
    expect(logGroupsMissing(fake, TERRAFORM)).toEqual(['postgresql']);
    const extra = 'resource "aws_cloudwatch_log_group" "union" {\n  name = "/fh/union"\n}\n';
    expect(logGroupsMissing(LEDGER, [...TERRAFORM, extra])).toEqual(['union']);
  });
});
