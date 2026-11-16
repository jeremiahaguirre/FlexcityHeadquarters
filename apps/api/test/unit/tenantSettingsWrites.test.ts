import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TENANT_JSON_COLUMNS } from '../../src/lib/tenantSettings.js';

// Organization settings (the Tenant row's JSON columns) are written through lib/tenantSettings.ts,
// which locks the row and starts from what is stored (ARCHITECTURE-REVIEW A11). The writes below
// predate it and are being moved over: this list may only shrink. A new direct write fails here.
const NOT_YET_MOVED: Record<string, number> = {
  'routes/accounting.ts': 1,
  'routes/care.ts': 1,
  'routes/features.ts': 1,
  // Reads under lockTenant() first, then writes through withSolverSettings (keeps unknown keys).
  'routes/fill.ts': 1,
  'routes/messages.ts': 1,
  'routes/payroll.ts': 4,
  'routes/payrollProvider.ts': 1,
  'routes/platform/cities.ts': 1,
  'routes/platform/payroll.ts': 1,
  'routes/settings.ts': 3,
  'routes/signup.ts': 1,
  'routes/surveys.ts': 1,
  'routes/winter.ts': 1,
  'routes/workRules.ts': 2,
  // Purge blanks a departing organization's settings on purpose.
  'services/platform/purge.ts': 1,
  'services/platform/releases.ts': 2,
};

const SRC = join(import.meta.dirname, '..', '..', 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'generated' ? [] : files(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('organization settings writes go through the locking helper', () => {
  const settingsWrite = new RegExp(`tenant\\.update\\([^\\n]*\\b(${TENANT_JSON_COLUMNS.join('|')})\\b`, 'g');
  const found: Record<string, number> = {};
  for (const f of files(SRC)) {
    const rel = relative(SRC, f).split('\\').join('/');
    if (rel === 'lib/tenantSettings.ts') continue;
    const n = (readFileSync(f, 'utf8').match(settingsWrite) ?? []).length;
    if (n) found[rel] = n;
  }

  it('no new direct write of a settings column, and the old ones only go away', () => {
    const grown = Object.entries(found).filter(([f, n]) => n > (NOT_YET_MOVED[f] ?? 0));
    expect(grown, 'Write organization settings with updateTenantJson / updateSolverSettings (lib/tenantSettings.ts)').toEqual([]);
  });

  it('every overtime policy and solver settings write uses it (the schedule fill used to reset settings changed meanwhile)', () => {
    const op = files(SRC).filter((f) => !f.endsWith('tenantSettings.ts') && !f.endsWith('routes/fill.ts')).filter((f) => /tenant\.update\([^\n]*overtimePolicy/.test(readFileSync(f, 'utf8')));
    expect(op.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('the list is kept current: a moved write is taken off it', () => {
    const stale = Object.entries(NOT_YET_MOVED).filter(([f, n]) => (found[f] ?? 0) < n);
    expect(stale).toEqual([]);
  });
});
