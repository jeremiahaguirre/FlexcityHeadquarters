/**
 * People review: turns facts already in the app (attendance events, conduct
 * notes, discipline history) into flags and a suggested next step for HR and
 * supervisors.
 *
 * It ADVISES; a person decides. Nothing here changes a schedule, issues
 * discipline or ends employment (Quebec Law 25 s.12.1; human-rights law).
 * Safeguards built in:
 *  - Attendance comes from the reliability score, which already leaves out
 *    sick days, protected leave and excused events.
 *  - Being named in an incident report never counts. Only a conduct note a
 *    supervisor chose to write (and can retract) does, so safety reporting
 *    stays free of reprisal (OHS acts).
 *  - Commendations are shown alongside concerns, so the file is balanced.
 *  - Each flag says exactly which facts raised it.
 */
import type { ConductCategory, DisciplineLevel, ReliabilityEventType } from '../../generated/prisma/client.js';

export const LEVELS: DisciplineLevel[] = ['COACHING', 'VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'TERMINATION'];
/** Records older than this no longer count toward the next step (common "sunset" in agreements). */
export const RECORD_ACTIVE_DAYS = 365;
const DAY = 86_400_000;

export const THRESHOLDS = {
  lowScore: 70,
  noShows90: 2,
  latePunches30: 3,
  concerns90: 2,
  unsignedDays: 14,
} as const;

export type Flag =
  | { code: 'LOW_SCORE'; score: number }
  | { code: 'REPEATED_NO_SHOWS'; count: number }
  | { code: 'FREQUENT_LATE'; count: number }
  | { code: 'SAFETY_CONCERN'; count: number }
  | { code: 'CONDUCT_PATTERN'; count: number }
  | { code: 'UNSIGNED_RECORD'; days: number };

export interface ReviewInput {
  score: number;
  counted: Array<{ type: ReliabilityEventType; occurredAt: Date }>;
  excludedCount: number;
  notes: Array<{ category: ConductCategory; occurredAt: Date; retractedAt: Date | null }>;
  records: Array<{ level: DisciplineLevel | null; issuedAt: Date; acknowledgedAt: Date | null }>;
}

export interface Review {
  flags: Flag[];
  attention: boolean;
  /** Active (unexpired) records, most serious first. */
  activeLevel: DisciplineLevel | null;
  /** Typical next step under progressive discipline, if anything is flagged. */
  suggestedLevel: DisciplineLevel | null;
  commendations90: number;
  /** Some events were left out (protected leave or excused): worth a look before acting. */
  hasExclusions: boolean;
}

const within = (d: Date, days: number, now: Date) => now.getTime() - d.getTime() <= days * DAY && d.getTime() <= now.getTime();

export function review(input: ReviewInput, now = new Date()): Review {
  const flags: Flag[] = [];
  if (input.score < THRESHOLDS.lowScore) flags.push({ code: 'LOW_SCORE', score: input.score });

  const noShows = input.counted.filter((e) => e.type === 'NO_SHOW' && within(e.occurredAt, 90, now)).length;
  if (noShows >= THRESHOLDS.noShows90) flags.push({ code: 'REPEATED_NO_SHOWS', count: noShows });

  const late = input.counted.filter((e) => e.type === 'LATE_PUNCH' && within(e.occurredAt, 30, now)).length;
  if (late >= THRESHOLDS.latePunches30) flags.push({ code: 'FREQUENT_LATE', count: late });

  const live = input.notes.filter((n) => !n.retractedAt && within(n.occurredAt, 90, now));
  const safety = live.filter((n) => n.category === 'SAFETY_PROCEDURE').length;
  if (safety > 0) flags.push({ code: 'SAFETY_CONCERN', count: safety });
  const concerns = live.filter((n) => n.category !== 'COMMENDATION').length;
  if (concerns >= THRESHOLDS.concerns90) flags.push({ code: 'CONDUCT_PATTERN', count: concerns });

  const unsigned = input.records
    .filter((r) => !r.acknowledgedAt)
    .map((r) => Math.floor((now.getTime() - r.issuedAt.getTime()) / DAY))
    .filter((d) => d >= THRESHOLDS.unsignedDays);
  if (unsigned.length) flags.push({ code: 'UNSIGNED_RECORD', days: Math.max(...unsigned) });

  const active = input.records.filter((r) => r.level && within(r.issuedAt, RECORD_ACTIVE_DAYS, now)).map((r) => LEVELS.indexOf(r.level!));
  const top = active.length ? Math.max(...active) : -1;
  const activeLevel = top >= 0 ? LEVELS[top]! : null;
  // An unsigned-record reminder alone is admin, not a reason to escalate.
  const substantive = flags.some((f) => f.code !== 'UNSIGNED_RECORD');
  const suggestedLevel = substantive ? LEVELS[Math.min(top + 1, LEVELS.length - 1)]! : null;

  return {
    flags,
    attention: flags.length > 0,
    activeLevel,
    suggestedLevel,
    commendations90: live.filter((n) => n.category === 'COMMENDATION').length,
    hasExclusions: input.excludedCount > 0,
  };
}

/** Levels that end or interrupt employment: HR only, with confirmations and a fresh sign-in. */
export const SERIOUS_LEVELS: ReadonlySet<DisciplineLevel> = new Set(['SUSPENSION', 'TERMINATION']);

/**
 * What the issuer confirms before a suspension or termination is saved:
 *  - factsReviewed: the evidence attached is accurate and complete.
 *  - protectedGrounds: no absence or conduct relied on relates to a protected
 *    ground (disability, family status, pregnancy, religion…) or protected
 *    leave, and the duty to accommodate was considered.
 *  - employeeHeard: the employee was told the concerns and could respond.
 *  - agreementChecked: the collective agreement / policy steps were followed.
 *  - stewardOffered: a union steward was offered (union members only).
 *  - counselReviewed: notice, severance and cause were reviewed with counsel
 *    or the HR lead (terminations only).
 */
export const FAIR_PROCESS_CHECKS = ['factsReviewed', 'protectedGrounds', 'employeeHeard', 'agreementChecked', 'stewardOffered', 'counselReviewed'] as const;
export type FairProcessCheck = (typeof FAIR_PROCESS_CHECKS)[number];

/** Which confirmations a record needs, given its level and whether the person is in the union. */
export function requiredChecks(level: DisciplineLevel | null, unionMember: boolean): FairProcessCheck[] {
  if (!level || !SERIOUS_LEVELS.has(level)) return [];
  return FAIR_PROCESS_CHECKS.filter((c) => (c === 'stewardOffered' ? unionMember : c === 'counselReviewed' ? level === 'TERMINATION' : true));
}
