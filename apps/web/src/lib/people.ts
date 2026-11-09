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

export interface FileEvent {
  id: string;
  type: string;
  points: number;
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
}
export interface CaseFile {
  score: number;
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
