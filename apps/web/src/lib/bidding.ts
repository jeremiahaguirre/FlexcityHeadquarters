/** Shift bidding: the API's shapes and the pure helpers the screens share (item labels, outcome text, ranking moves). */
import { formatDate, formatTimeRange } from './format';
import { daysLabel, minutesRange } from './shiftTemplates';

export type RoundStatus = 'OPEN' | 'REVIEW' | 'AWARDED' | 'CANCELLED';
export type Outcome = 'AWARDED' | 'TAKEN_BY_SENIOR' | 'TAKEN_EARLIER_PASS' | 'NOT_ELIGIBLE' | 'LIMIT_REACHED' | 'OVERRIDDEN' | 'CHANGED';
export interface ChoiceOutcome { itemId: string; rank: number | null; result: Outcome; code?: string; pass?: number }
export interface BidItem {
  id: string;
  facility: string;
  position: { id: string; name: string; nameFr: string | null };
  shifts: number;
  localStartsAt: string;
  localEndsAt: string;
  meta: { daysOfWeek?: number[]; startMinute?: number; endMinute?: number };
  choices?: number;
}
export interface RoundHead { id: string; name: string; kind: 'SHIFTS' | 'LINES'; status: RoundStatus; opensAt: string; closesAt: string; maxAwardsPerPerson: number; seniorityBasis: 'DATE' | 'HOURS'; rangeFrom: string | null; rangeTo: string | null }
export interface MyRound extends RoundHead {
  items: BidItem[];
  myChoices: string[];
  seniority: { rank: number; of: number; seniorityDate: string | null; seniorityHours: number; hireDate: string | null };
  result: { awarded: string[]; outcomes: ChoiceOutcome[] } | null;
  maxChoices: number;
}
export interface RoundDetail extends RoundHead {
  access: 'manage' | 'observe';
  items: BidItem[];
  eligibleCount: number;
  bidders: number;
  order: Array<{ userId: string; name: string; rank: number; seniorityDate: string | null; seniorityHours: number; hireDate: string | null; tiebreak: string; outcomes: ChoiceOutcome[] }>;
  awards: Array<{ itemId: string; userId: string; name: string; pass: number; choiceRank: number | null; overridden: boolean; reason: string | null; by: string | null; previous: string | null }>;
  eligible: Array<{ id: string; name: string }>;
}

type T = (k: string, o?: Record<string, unknown>) => string;

/** "Mon–Fri 7:00 a.m.–3:00 p.m." for a line, "Sat, Nov 14 · 7:00 a.m.–3:00 p.m." for a shift. */
export function itemWhen(i: BidItem, lng: string, everyDay: string): string {
  if (i.meta.daysOfWeek?.length && i.meta.startMinute !== undefined && i.meta.endMinute !== undefined) return `${daysLabel(i.meta.daysOfWeek, lng, everyDay)} ${minutesRange(i.meta.startMinute, i.meta.endMinute, lng)}`;
  return `${formatDate(i.localStartsAt, lng)} · ${formatTimeRange(i.localStartsAt, i.localEndsAt, lng)}`;
}

/** For a line: the dates it covers and how many shifts. */
export function itemSpan(i: BidItem, lng: string, t: T): string | null {
  if (i.shifts < 2) return null;
  return t('bids.span', { from: formatDate(i.localStartsAt.slice(0, 10), lng), to: formatDate(i.localEndsAt.slice(0, 10), lng), count: i.shifts });
}

/** Why a choice went the way it did, in the person's words. */
export function outcomeText(o: ChoiceOutcome, t: T): string {
  if (o.result === 'NOT_ELIGIBLE') {
    const code = o.code ?? '';
    return t(`bids.notEligible`, { why: t(`blocks.${code}`, { defaultValue: t(`bids.code.${code}`, { defaultValue: t('bids.code.OTHER') }) }) });
  }
  return t(`bids.outcome.${o.result}`);
}

/** Moves one choice up or down a ranking (no-op at the ends). */
export function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const j = index + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}

/** "1st", "2nd"… in English; "1er", "2e"… in French. */
export function ordinal(n: number, lng: string): string {
  if (lng.startsWith('fr')) return n === 1 ? '1er' : `${n}e`;
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
