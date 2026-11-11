/** People review: types shared by the review list, the case file and "My file". */

export const LEVELS = ['COACHING', 'VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'TERMINATION'] as const;
export type Level = (typeof LEVELS)[number];
export const SERIOUS: ReadonlySet<string> = new Set(['SUSPENSION', 'TERMINATION']);
export const CATEGORIES = ['SAFETY_PROCEDURE', 'POLICY', 'CONDUCT', 'PERFORMANCE', 'COMMENDATION'] as const;
export const CHECKS = ['factsReviewed', 'protectedGrounds', 'employeeHeard', 'agreementChecked', 'stewardOffered', 'counselReviewed'] as const;
export type Check = (typeof CHECKS)[number];

export type Flag = { code: 'LOW_SCORE'; score: number } | { code: 'REPEATED_NO_SHOWS' | 'FREQUENT_LATE' | 'SAFETY_CONCERN' | 'CONDUCT_PATTERN'; count: number } | { code: 'UNSIGNED_RECORD'; days: number };

export interface Review {
  flags: Flag[];
  attention: boolean;
  activeLevel: Level | null;
  suggestedLevel: Level | null;
  commendations90: number;
  hasExclusions: boolean;
}

/** Where an event stands for the score now (it always stays on the record). */
export type EventStatus = 'COUNTED' | 'FADING' | 'EXCUSED' | 'PROTECTED' | 'RESTARTED' | 'AGED_OUT';
export type RecoveryMode = 'GRADUAL' | 'RESET' | 'BOTH';

/** One explained change to the score; `applied` is what it actually moved (the score stays between 0 and 100). */
export interface ScoreChange {
  kind: 'EVENT' | 'ON_TIME' | 'STREAK' | 'CLEAN' | 'COMMENDATION' | 'RESTART';
  at: string;
  points: number;
  applied: number;
  eventId?: string;
  eventType?: string;
  basePoints?: number;
  fading?: boolean;
  month?: string;
  count?: number;
  days?: number;
  noteId?: string;
}

export interface ScoreRules {
  windowDays: number;
  fullWeightDays: number;
  fadedWeight: number;
  onTimeShift: number;
  onTimeShiftMonthlyCap: number;
  streakLength: number;
  streakBonus: number;
  cleanDays: number;
  cleanBonus: number;
  commendation: number;
  commendationMonthlyCap: number;
}

export interface ReliabilityExplain {
  mode: RecoveryMode;
  countsFrom: string;
  restartedAt: string | null;
  nextRestartAt: string | null;
  streak: number;
  changes: ScoreChange[];
  rules: ScoreRules;
}

export interface FileEvent {
  id: string;
  type: string;
  /** What it counts for now (half once fading). */
  points: number;
  basePoints?: number;
  status?: EventStatus;
  occurredAt: string;
  note: string | null;
  counted: boolean;
  excludedReason: string | null;
  source: 'TIMECLOCK' | 'SHIFT_BOARD' | 'SCHEDULE' | 'SUPERVISOR';
}
export interface FileNote {
  id: string;
  category: (typeof CATEGORIES)[number];
  summary: string;
  occurredAt: string;
  incidentId: string | null;
  retractedAt: string | null;
  retractedReason: string | null;
  recordedBy: string;
}
export interface Evidence {
  kind: 'EVENT' | 'NOTE';
  id: string;
  type?: string;
  category?: string;
  occurredAt: string;
  note?: string | null;
  summary?: string;
}
export interface FileRecord {
  id: string;
  level: Level | null;
  summary: string;
  issuedAt: string;
  acknowledgedAt: string | null;
  stewardPresent: boolean;
  employeeResponse: string | null;
  respondedAt: string | null;
  evidence: Evidence[];
  /** Fingerprint of what was signed, and whether the record still matches it. */
  signatureCheck?: { signed: string | null; signature: string | null; intact: boolean | null } | null;
}
export interface CaseFile {
  /** The viewer isn't HR: only records they made themselves are shown. */
  onlyMine?: boolean;
  score: number;
  /** How the score got here (older demo data may not have it). */
  reliability?: ReliabilityExplain;
  review: Review;
  events: FileEvent[];
  notes: FileNote[];
  records: FileRecord[];
}
export interface ReviewRow {
  id: string;
  name: string;
  roles: string[];
  score: number;
  flaggedSince: string | null;
  review: Review;
}

/** Which confirmations a record needs (mirrors the API's requiredChecks). */
export function requiredChecks(level: string | null, unionMember: boolean): Check[] {
  if (!level || !SERIOUS.has(level)) return [];
  return CHECKS.filter((c) => (c === 'stewardOffered' ? unionMember : c === 'counselReviewed' ? level === 'TERMINATION' : true));
}

/** Calendar day of an ISO timestamp, for formatDate's "dated" style. */
export const dayOf = (iso: string) => `${iso.slice(0, 10)}T12:00:00`;

/** Facts from the last 90 days a record would usually rely on. */
export function recentFacts(file: CaseFile, now = Date.now()) {
  const recent = (iso: string) => now - new Date(iso).getTime() <= 90 * 86_400_000;
  return {
    events: file.events.filter((e) => e.counted && e.points < 0 && recent(e.occurredAt)),
    notes: file.notes.filter((n) => !n.retractedAt && n.category !== 'COMMENDATION' && recent(n.occurredAt)),
  };
}
