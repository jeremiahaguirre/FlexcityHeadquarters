import { describe, expect, it } from 'vitest';
import { CONTROLS, FRAMEWORKS, controlsFor, libraryProblems, type Control } from '../../src/services/trust/library.js';
import { headerProblems, rlsLists, scrubDetails } from '../../src/services/trust/monitors.js';
import { controlStatus, daysUntil, frameworkReadiness, nextDue, postureScore, readinessBand, reminderDue, riskLevel, riskScore, vendorRisk, vendorScore, type ControlStatus } from '../../src/services/trust/scoring.js';

const now = new Date('2026-11-11T15:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
const ctl = (over: Partial<Control> = {}): Control => ({ key: 'X-1', category: 'access', title: 'x', titleFr: 'x', description: '', descriptionFr: '', tests: [], maps: [], ...over });

describe('control library', () => {
  it('has no broken mappings or duplicates', () => {
    expect(libraryProblems()).toEqual([]);
  });

  it('covers ISO 27001 Annex A in full (93 controls) and every clause 4–10', () => {
    const iso = FRAMEWORKS.find((f) => f.key === 'iso27001')!;
    expect(iso.requirements.filter((r) => r.id.startsWith('A.')).length).toBe(93);
    expect(iso.requirements.filter((r) => !r.id.startsWith('A.')).map((r) => r.id[0])).toEqual(expect.arrayContaining(['4', '5', '6', '7', '8', '9', '1']));
  });

  it('maps every SOC 2 criterion and every Annex A control to at least one FH control', () => {
    for (const key of ['soc2', 'iso27001', 'pipeda', 'law25'] as const) {
      const fw = FRAMEWORKS.find((f) => f.key === key)!;
      const uncovered = fw.requirements.filter((r) => !r.na && !controlsFor(key, r.id).length).map((r) => r.id);
      expect(uncovered, key).toEqual([]);
    }
  });

  it('marks HIPAA optional, with a note that it applies to US health information', () => {
    const h = FRAMEWORKS.find((f) => f.key === 'hipaa')!;
    expect(h.optional).toBe(true);
    expect(h.note).toMatch(/US protected health information/);
    expect(h.noteFr).toMatch(/États-Unis/);
  });

  it('gives every control and requirement a French title', () => {
    for (const c of CONTROLS) expect(c.titleFr && c.descriptionFr, c.key).toBeTruthy();
    for (const f of FRAMEWORKS) for (const r of f.requirements) expect(r.titleFr, `${f.key}:${r.id}`).toBeTruthy();
  });
});

describe('control status', () => {
  const base = { tests: {}, evidenceAt: {}, manual: {}, now };
  it('fails on a failing or broken test, needs evidence on a warning or a test not run yet', () => {
    const c = ctl({ tests: ['a', 'b'] });
    expect(controlStatus(c, { ...base, tests: { a: 'PASS', b: 'FAIL' } })).toBe('FAILING');
    expect(controlStatus(c, { ...base, tests: { a: 'PASS', b: 'ERROR' } })).toBe('FAILING');
    expect(controlStatus(c, { ...base, tests: { a: 'PASS', b: 'WARN' } })).toBe('NEEDS_EVIDENCE');
    expect(controlStatus(c, { ...base, tests: { a: 'PASS' } })).toBe('NEEDS_EVIDENCE');
    expect(controlStatus(c, { ...base, tests: { a: 'PASS', b: 'PASS' } })).toBe('PASSING');
  });

  it('needs evidence newer than its window', () => {
    const c = ctl({ evidenceDays: 35 });
    expect(controlStatus(c, base)).toBe('NEEDS_EVIDENCE');
    expect(controlStatus(c, { ...base, evidenceAt: { 'X-1': days(-34) } })).toBe('PASSING');
    expect(controlStatus(c, { ...base, evidenceAt: { 'X-1': days(-36) } })).toBe('NEEDS_EVIDENCE');
  });

  it('lets a manual status (with its justification, checked by the route) win', () => {
    expect(controlStatus(ctl({ tests: ['a'] }), { ...base, tests: { a: 'FAIL' }, manual: { 'X-1': { status: 'NOT_APPLICABLE' } } })).toBe('NOT_APPLICABLE');
  });
});

describe('readiness and posture', () => {
  const controls: Control[] = [ctl({ key: 'A', maps: ['pipeda:4.1', 'pipeda:4.2'] }), ctl({ key: 'B', maps: ['pipeda:4.2'] }), ctl({ key: 'C', maps: ['pipeda:4.3'] })];
  it('counts a requirement by the share of its controls passing, and unmapped requirements as gaps', () => {
    const r = frameworkReadiness('pipeda', { A: 'PASSING', B: 'FAILING', C: 'NOT_APPLICABLE' }, controls);
    // 11 requirements: 4.1 met (1), 4.2 half (0.5), 4.3 not applicable (left out), 8 unmapped (0) → 1.5 / 10.
    expect(r).toMatchObject({ met: 1, partial: 1, notApplicable: 1, uncovered: 8, readiness: 15 });
  });

  it('scores posture over in-scope controls, counting “needs evidence” as half', () => {
    const s: Record<string, ControlStatus> = { A: 'PASSING', B: 'NEEDS_EVIDENCE', C: 'FAILING' };
    expect(postureScore(s, [], controls)).toBe(50);
    expect(postureScore(s, ['soc2'], controls)).toBe(0);
    expect(postureScore({ A: 'PASSING', B: 'NOT_APPLICABLE', C: 'NOT_APPLICABLE' }, [], controls)).toBe(100);
  });

  it('never bands a framework as certified', () => {
    expect([readinessBand(10), readinessBand(55), readinessBand(75), readinessBand(95)]).toEqual(['early', 'progressing', 'advanced', 'ready']);
  });
});

describe('risks and vendors', () => {
  it('scores likelihood × impact against the appetite', () => {
    expect(riskScore(3, 5)).toBe(15);
    expect(riskScore(9, 0)).toBe(5);
    expect(riskLevel(15, 12)).toBe('high');
    expect(riskLevel(8, 12)).toBe('medium');
    expect(riskLevel(4, 12)).toBe('low');
    expect(riskLevel(8, 8)).toBe('high');
  });

  it('scores the vendor questionnaire (partial = half, n/a left out)', () => {
    expect(vendorScore(null)).toBeNull();
    expect(vendorScore({})).toBeNull();
    expect(vendorScore({ certification: 'yes', dpa: 'yes', canada: 'yes', encryption: 'yes', mfa: 'yes', breachNotice: 'yes', subprocessors: 'yes', pentest: 'yes', deletion: 'yes', logging: 'yes' })).toBe(100);
    expect(vendorScore({ certification: 'partial', dpa: 'no' })).toBe(29);
    expect(vendorScore({ canada: 'na' })).toBe(100);
  });

  it('rates vendor risk from criticality, personal information, location and score', () => {
    expect(vendorRisk({ criticality: 'CRITICAL', personalInfo: true, inCanada: true, score: 90 })).toBe('high');
    expect(vendorRisk({ criticality: 'LOW', personalInfo: false, inCanada: false, score: null })).toBe('low');
    expect(vendorRisk({ criticality: 'MEDIUM', personalInfo: true, inCanada: true, score: 80 })).toBe('medium');
  });
});

describe('reminders and recurrence', () => {
  it('counts calendar days', () => {
    expect(daysUntil(new Date('2026-11-12T01:00:00Z'), now)).toBe(1);
    expect(daysUntil(new Date('2026-11-10T23:00:00Z'), now)).toBe(-1);
  });

  it('sends 30, 7 and 1 day before, then once when overdue, each once', () => {
    expect(reminderDue(days(40), now, [])).toBeNull();
    expect(reminderDue(days(30), now, [])).toBe(30);
    expect(reminderDue(days(20), now, [30])).toBeNull();
    expect(reminderDue(days(7), now, [30])).toBe(7);
    expect(reminderDue(days(1), now, [30, 7])).toBe(1);
    expect(reminderDue(days(0), now, [30, 7, 1])).toBeNull();
    expect(reminderDue(days(-1), now, [30, 7, 1])).toBe(0);
    expect(reminderDue(days(-3), now, [30, 7, 1, 0])).toBeNull();
  });

  it('skips straight to the closest reminder for something tracked late', () => {
    expect(reminderDue(days(5), now, [])).toBe(7);
    expect(reminderDue(days(5), now, [7])).toBeNull();
  });

  it('moves recurring dates forward, keeping month ends sensible', () => {
    expect(nextDue(new Date('2026-01-31T12:00:00Z'), 'MONTHLY')!.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(nextDue(new Date('2026-11-15T12:00:00Z'), 'QUARTERLY')!.toISOString()).toBe('2027-02-15T12:00:00.000Z');
    expect(nextDue(new Date('2026-03-01T12:00:00Z'), 'YEARLY')!.toISOString()).toBe('2027-03-01T12:00:00.000Z');
    expect(nextDue(now, 'NONE')).toBeNull();
  });
});

describe('monitor helpers', () => {
  it('reads the RLS lists from rls.sql', () => {
    const l = rlsLists()!;
    expect(l.tenant).toContain('User');
    expect(l.fh).toContain('PlatformAudit');
    expect(l.fhOnly).toContain('TrustRisk');
  });

  it('flags missing headers, and HSTS only in production', () => {
    const good = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'referrer-policy': 'same-origin' };
    expect(headerProblems(good, false).missing).toEqual([]);
    expect(headerProblems(good, true).missing).toEqual(['Strict-Transport-Security']);
    expect(headerProblems({ ...good, 'strict-transport-security': 'max-age=31536000' }, true)).toEqual({ missing: [], hsts: true });
    expect(headerProblems({}, false).missing).toHaveLength(4);
  });

  it('drops anything that looks like a secret from a result', () => {
    expect(scrubDetails({ length: 64, jwtSecret: 'x', token: 'y', databaseUrl: 'z', kmsKeyArn: 'k', admins: 2 })).toEqual({ length: 64, admins: 2 });
  });
});
