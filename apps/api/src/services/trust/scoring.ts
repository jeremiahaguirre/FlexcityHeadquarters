/**
 * Pure rules for the Trust area: a control's status from its tests and evidence, framework
 * readiness, the overall posture score, risk scores, reminder timing and recurrence, and the
 * vendor questionnaire score. No database here, so every rule has a unit test.
 */
import { CONTROLS, FRAMEWORKS, type Control, type FrameworkKey } from './library.js';

export type TestStatus = 'PASS' | 'FAIL' | 'WARN' | 'ERROR';
export type ControlStatus = 'PASSING' | 'FAILING' | 'NEEDS_EVIDENCE' | 'NOT_APPLICABLE';
export const CONTROL_STATUSES: ControlStatus[] = ['PASSING', 'FAILING', 'NEEDS_EVIDENCE', 'NOT_APPLICABLE'];

export interface ControlInputs {
  /** Latest status per test key (missing = never run). */
  tests: Record<string, TestStatus | undefined>;
  /** Newest evidence that still counts, per control (validUntil not passed). */
  evidenceAt: Record<string, Date | undefined>;
  manual: Record<string, { status: ControlStatus | null } | undefined>;
  now: Date;
}

const DAY = 86_400_000;

/**
 * - A manual status (not applicable, with its justification, or an override) wins.
 * - Any failing or broken test: FAILING.
 * - A test that warns or hasn't run yet, or evidence missing or older than the control's window: NEEDS_EVIDENCE.
 * - Otherwise PASSING. A control with neither tests nor an evidence window needs evidence once.
 */
export function controlStatus(c: Control, i: ControlInputs): ControlStatus {
  const manual = i.manual[c.key]?.status;
  if (manual) return manual;
  const results = c.tests.map((t) => i.tests[t]);
  if (results.some((r) => r === 'FAIL' || r === 'ERROR')) return 'FAILING';
  if (results.some((r) => r === undefined || r === 'WARN')) return 'NEEDS_EVIDENCE';
  const ev = i.evidenceAt[c.key];
  if (c.evidenceDays) {
    if (!ev || i.now.getTime() - ev.getTime() > c.evidenceDays * DAY) return 'NEEDS_EVIDENCE';
  } else if (!c.tests.length && !ev) return 'NEEDS_EVIDENCE';
  return 'PASSING';
}

export interface Readiness {
  framework: FrameworkKey;
  /** 0–100: requirements met, partly met ones counting their share of passing controls. */
  readiness: number;
  met: number;
  partial: number;
  gaps: number;
  /** Requirements with no control mapped yet. */
  uncovered: number;
  notApplicable: number;
  total: number;
}

/**
 * Per requirement: the share of its applicable controls that pass (a requirement whose controls
 * are all not applicable, or that the library marks not applicable, is left out). A requirement
 * with no control mapped counts as 0, so a gap in the library shows as a gap, not as readiness.
 */
export function frameworkReadiness(key: FrameworkKey, statuses: Record<string, ControlStatus>, controls: Control[] = CONTROLS): Readiness {
  const fw = FRAMEWORKS.find((f) => f.key === key)!;
  let sum = 0;
  let counted = 0;
  let met = 0;
  let partial = 0;
  let gaps = 0;
  let uncovered = 0;
  let na = 0;
  for (const r of fw.requirements) {
    if (r.na) {
      na++;
      continue;
    }
    const mapped = controls.filter((c) => c.maps.includes(`${key}:${r.id}`));
    const applicable = mapped.filter((c) => statuses[c.key] !== 'NOT_APPLICABLE');
    if (mapped.length && !applicable.length) {
      na++;
      continue;
    }
    counted++;
    if (!mapped.length) {
      uncovered++;
      gaps++;
      continue;
    }
    const share = applicable.filter((c) => statuses[c.key] === 'PASSING').length / applicable.length;
    sum += share;
    if (share === 1) met++;
    else if (share > 0) partial++;
    else gaps++;
  }
  return { framework: key, readiness: counted ? Math.round((100 * sum) / counted) : 0, met, partial, gaps, uncovered, notApplicable: na, total: fw.requirements.length };
}

/** Controls that count toward a scope: mapped to at least one framework in it (all frameworks when empty). */
export function controlsInScope(scope: FrameworkKey[], controls: Control[] = CONTROLS): Control[] {
  if (!scope.length) return controls;
  return controls.filter((c) => c.maps.some((x) => scope.includes(x.split(':')[0] as FrameworkKey)));
}

/**
 * Overall posture, 0–100: the share of applicable in-scope controls passing, where a control that
 * needs evidence counts half (it may well be in place; it isn't proven) and a failing one nothing.
 */
export function postureScore(statuses: Record<string, ControlStatus>, scope: FrameworkKey[] = [], controls: Control[] = CONTROLS): number {
  const list = controlsInScope(scope, controls).filter((c) => statuses[c.key] !== 'NOT_APPLICABLE');
  if (!list.length) return 0;
  const pts = list.reduce((s, c) => s + (statuses[c.key] === 'PASSING' ? 1 : statuses[c.key] === 'NEEDS_EVIDENCE' ? 0.5 : 0), 0);
  return Math.round((100 * pts) / list.length);
}

/** Readiness bands used in exports and present mode: never "certified" unless an audit report is recorded. */
export function readinessBand(pct: number): 'early' | 'progressing' | 'advanced' | 'ready' {
  return pct >= 90 ? 'ready' : pct >= 70 ? 'advanced' : pct >= 40 ? 'progressing' : 'early';
}

// ---- Risks -------------------------------------------------------------------------------

export const clamp15 = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
export const riskScore = (likelihood: number, impact: number) => clamp15(likelihood) * clamp15(impact);
/** Against the risk appetite (the score at or above which a risk is "high"). */
export function riskLevel(score: number, appetite: number): 'low' | 'medium' | 'high' {
  if (score >= appetite) return 'high';
  if (score >= Math.max(1, Math.ceil(appetite / 2))) return 'medium';
  return 'low';
}
export const APPETITE_RANGE = [4, 25] as const;

// ---- Dates, reminders and recurrence ----------------------------------------------------------

export type Recurrence = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
/** Days before a due date that reminders go out. */
export const REMINDER_DAYS = [30, 7, 1] as const;

/** Whole days from now until `due` (negative once past), by UTC calendar day. */
export function daysUntil(due: Date, now: Date): number {
  const d = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d - n) / DAY);
}

/**
 * The reminder due now for something due on `due`: the smallest of REMINDER_DAYS that the days
 * left have reached, unless it (or a closer one) was already sent; 0 means "overdue" (sent once).
 * Something first tracked 5 days before its due date gets the 7-day reminder at once, not the 30-day one.
 */
export function reminderDue(due: Date, now: Date, sent: number[], offsets: readonly number[] = REMINDER_DAYS): number | null {
  const left = daysUntil(due, now);
  if (left < 0) return sent.includes(0) ? null : 0;
  const reached = [...offsets].sort((a, b) => a - b).find((d) => left <= d);
  if (reached === undefined) return null;
  if (sent.some((s) => s <= reached)) return null;
  return reached;
}

/** The next due date for a recurring item, after `from` (keeps the day of month where it can). */
export function nextDue(from: Date, recurrence: Recurrence): Date | null {
  const months = recurrence === 'MONTHLY' ? 1 : recurrence === 'QUARTERLY' ? 3 : recurrence === 'YEARLY' ? 12 : 0;
  return months ? addMonths(from, months) : null;
}

export function addMonths(d: Date, months: number): Date {
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes()));
}

// ---- Vendor questionnaire -------------------------------------------------------------------

/** The built-in vendor security questionnaire. Each "yes" earns the weight; "partial" half. */
export const VENDOR_QUESTIONS = [
  { key: 'certification', weight: 20 },
  { key: 'dpa', weight: 15 },
  { key: 'canada', weight: 15 },
  { key: 'encryption', weight: 10 },
  { key: 'mfa', weight: 10 },
  { key: 'breachNotice', weight: 10 },
  { key: 'subprocessors', weight: 5 },
  { key: 'pentest', weight: 5 },
  { key: 'deletion', weight: 5 },
  { key: 'logging', weight: 5 },
] as const;
export type VendorAnswer = 'yes' | 'partial' | 'no' | 'na';

/** 0–100, or null with no answers. "Not applicable" questions drop out of the total. */
export function vendorScore(answers: Record<string, VendorAnswer | undefined> | null | undefined): number | null {
  if (!answers) return null;
  let got = 0;
  let max = 0;
  let any = false;
  for (const q of VENDOR_QUESTIONS) {
    const a = answers[q.key];
    if (!a) continue;
    any = true;
    if (a === 'na') continue;
    max += q.weight;
    got += a === 'yes' ? q.weight : a === 'partial' ? q.weight / 2 : 0;
  }
  if (!any) return null;
  return max ? Math.round((100 * got) / max) : 100;
}

/** Inherent vendor risk for the distribution chart: criticality, personal information, location and score. */
export function vendorRisk(v: { criticality: string; personalInfo: boolean; inCanada: boolean; score: number | null }): 'low' | 'medium' | 'high' {
  let pts = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[v.criticality] ?? 1;
  if (v.personalInfo) pts += 1;
  if (!v.inCanada && v.personalInfo) pts += 1;
  if (v.score !== null && v.score < 60) pts += 1;
  if (v.score === null && v.personalInfo) pts += 1;
  return pts >= 4 ? 'high' : pts >= 2 ? 'medium' : 'low';
}
