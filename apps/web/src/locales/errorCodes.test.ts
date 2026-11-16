import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en-CA.json';
import fr from './fr-CA.json';

/**
 * Every error code the API can send a person has a message in both languages
 * (errors.<CODE>), so a French speaker never reads the server's English. Codes
 * only the public API sends (its callers are programs, documented in English)
 * are exempt, as are the files that still use the generic badRequest() below.
 */
const API = join(__dirname, '../../../api/src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'generated') return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
const sources = files(API).map((p) => ({ file: relative(API, p), text: readFileSync(p, 'utf8') }));

/** Files whose callers are programs: the public API, its idempotency keys, Stripe's webhook. */
const MACHINE_ONLY = [/^routes\/publicApi[A-Za-z]*\.ts$/, /^services\/integrations\/idempotency\.ts$/, /^services\/billing\/stripe\.ts$/];
/** Sent to no person: the main API's answer when a request for the separate Union Hub service reaches it. */
const INTERNAL = new Set(['UNION_ELSEWHERE']);

const THROWN = /(?:new\s+HttpError\(\s*\d+\s*,\s*|conflict\(\s*|invalid\(\s*)'([A-Z][A-Z0-9_]+)'/g;
const thrown = new Map<string, string[]>();
for (const s of sources) for (const m of s.text.matchAll(THROWN)) thrown.set(m[1]!, [...(thrown.get(m[1]!) ?? []), s.file]);
// Answered directly as JSON ({ code: 'X' }) rather than thrown.
for (const s of sources) for (const m of s.text.matchAll(/json\(\{\s*code:\s*'([A-Z][A-Z0-9_]+)'/g)) thrown.set(m[1]!, [...(thrown.get(m[1]!) ?? []), s.file]);
// The helpers' own codes, and the demo's.
for (const c of ['NOT_FOUND', 'FORBIDDEN', 'BAD_REQUEST', 'VALIDATION', 'NOT_IN_DEMO']) thrown.set(c, [...(thrown.get(c) ?? []), 'helper']);

const personFacing = [...thrown].filter(([code, where]) => !INTERNAL.has(code) && where.some((f) => f === 'helper' || !MACHINE_ONLY.some((r) => r.test(f)))).map(([code]) => code);

/**
 * Generic badRequest() calls left, per file: these show "Some details aren't right".
 * Time off, timesheets, payroll and positions belong to another change; the count
 * can only go down, and a new file can't add one.
 */
const GENERIC_LEFT: Record<string, number> = {
  'services/people/timeOff.ts': 7,
  'services/timeclock/review.ts': 4,
  'services/timeclock/punches.ts': 3,
  'services/payroll/bank.ts': 3,
  'services/payroll/payRuns.ts': 2,
  'services/payroll/payrollRun.ts': 1,
  'services/people/positionAdmin.ts': 1,
  'routes/payroll.ts': 4,
  'routes/payrollFull.ts': 1,
  'routes/attendance.ts': 1,
  'routes/staff.ts': 2,
};

describe('server error codes people can see', () => {
  it('found the codes', () => {
    expect(personFacing.length).toBeGreaterThan(200);
    expect(personFacing).toContain('EMAIL_TAKEN');
    expect(personFacing).not.toContain('IDEMPOTENCY_KEY_REQUIRED');
  });

  for (const [name, dict] of [['en-CA', en], ['fr-CA', fr]] as const) {
    it(`${name}: every one has errors.<CODE>`, () => {
      const errors = (dict as { errors: Record<string, string> }).errors;
      expect(personFacing.filter((c) => typeof errors[c] !== 'string').sort()).toEqual([]);
    });
  }

  it('the two languages use the same placeholders in each message', () => {
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(en.errors).filter((k) => JSON.stringify(vars((en.errors as Record<string, string>)[k]!)) !== JSON.stringify(vars((fr.errors as Record<string, string>)[k] ?? '')));
    expect(mismatched).toEqual([]);
  });

  it('no new generic badRequest(): a 400 a person can fix gets its own code (invalid())', () => {
    const counts = Object.fromEntries(sources.map((s) => [s.file, (s.text.match(/\bbadRequest\(/g) ?? []).length - (s.file === 'lib/errors.ts' ? 1 : 0)]).filter(([, n]) => (n as number) > 0));
    const over = Object.entries(counts).filter(([f, n]) => (n as number) > (GENERIC_LEFT[f] ?? 0));
    expect(over).toEqual([]);
  });
});
