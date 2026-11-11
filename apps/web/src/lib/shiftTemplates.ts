/**
 * Weekly shift templates and shift preferences: types the API returns and the small pure helpers the
 * screens share (minutes ↔ "HH:MM", day lists as "Mon–Fri", a preference's one-line summary).
 */
import { formatHours, formatTimeRange } from './format';

export interface TemplateSlot {
  id?: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  facilityId: string;
  positionId: string;
  headcount: number;
  unpaidBreakMinutes: number | null;
}
export interface ShiftTemplate {
  id: string;
  name: string;
  departmentId: string | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  autoWeeksAhead: number;
  slots: TemplateSlot[];
  updatedAt: string;
}
export interface TemplateApplication { id: string; templateId: string; from: string; to: string; automatic: boolean; created: number; notes: number; undoneAt: string | null; createdAt: string }
export interface TemplatesView { templates: ShiftTemplate[]; applications: TemplateApplication[]; autoCreate: boolean; canConfigure: boolean; maxDays: number }
export type OccurrenceCode = 'HOLIDAY_CLOSED' | 'FACILITY_CLOSED' | 'OUTSIDE_HOURS' | 'STAT_HOLIDAY';
export interface ApplyResult {
  applicationId: string | null;
  created: number;
  existing: number;
  skipped: number;
  flagged: number;
  outsideDates: number;
  items: Array<{ slotId: string; date: string; startsAt: string; endsAt: string; status: 'create' | 'existing' | 'skipped'; count: number; code: OccurrenceCode | null }>;
}

export interface PreferenceWindow { id?: string; kind: 'PREFER' | 'AVOID'; daysOfWeek: number[]; startMinute: number | null; endMinute: number | null; positionId: string | null; facilityId: string | null; note?: string | null }
export interface StatedPreferences { windows: PreferenceWindow[]; maxWeeklyHours: number | null; maxDaysPerWeek: number | null }

/** Monday first, as in Canada. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export const toHHMM = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fromHHMM = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : null);
/** An end at or before the start runs past midnight. */
export const endAfter = (start: number, end: number) => (end <= start ? end + 1440 : end);

/** Short weekday names in the locale, Sunday = 0. */
export function weekdayNames(lng: string, style: 'short' | 'long' = 'short'): string[] {
  const f = new Intl.DateTimeFormat(lng, { weekday: style, timeZone: 'UTC' });
  // 2026-11-01 is a Sunday.
  return Array.from({ length: 7 }, (_, d) => f.format(new Date(Date.UTC(2026, 10, 1 + d, 12))));
}

/** "Mon–Fri", "Sat, Sun", "Mon, Wed, Fri" (runs of three or more as a range, Monday first). */
export function daysLabel(days: number[], lng: string, everyDay: string): string {
  const set = new Set(days);
  if (set.size === 7) return everyDay;
  const names = weekdayNames(lng);
  const ordered = WEEK.filter((d) => set.has(d));
  const runs: number[][] = [];
  for (const d of ordered) {
    const last = runs.at(-1);
    if (last && WEEK.indexOf(d as (typeof WEEK)[number]) === WEEK.indexOf(last.at(-1) as (typeof WEEK)[number]) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${names[r[0]!]}–${names[r.at(-1)!]}` : r.map((d) => names[d]).join(', '))).join(', ');
}

/** "7:00 a.m.–3:00 p.m." for minutes after midnight (an end past 1440 runs past midnight). */
export function minutesRange(start: number, end: number, lng: string): string {
  const iso = (m: number) => `2000-01-0${1 + Math.floor(m / 1440)}T${toHHMM(m)}:00`;
  return formatTimeRange(iso(start), iso(end), lng);
}

/** People and paid-less-break hours one template week asks for. */
export function weekTotals(slots: TemplateSlot[]): { shifts: number; hours: number } {
  let shifts = 0;
  let hours = 0;
  for (const s of slots) {
    const n = s.daysOfWeek.length * s.headcount;
    shifts += n;
    hours += n * Math.max(0, (s.endMinute - s.startMinute - (s.unpaidBreakMinutes ?? 0)) / 60);
  }
  return { shifts, hours: Math.round(hours * 100) / 100 };
}

/**
 * One line a scheduler can read at a glance: "Prefers Mon–Fri 7:00 a.m.–12:00 p.m. · Avoids Sun ·
 * Up to 24 h a week · Up to 4 days". `t` is i18next's (keys under prefs.summary.*).
 */
export function preferenceSummary(p: StatedPreferences | null | undefined, t: (k: string, o?: Record<string, unknown>) => string, lng: string, names: { position?: (id: string) => string | undefined; facility?: (id: string) => string | undefined } = {}): string[] {
  if (!p) return [];
  const out: string[] = [];
  const describe = (w: PreferenceWindow) =>
    [
      w.daysOfWeek.length ? daysLabel(w.daysOfWeek, lng, t('prefs.everyDay')) : null,
      w.startMinute !== null && w.endMinute !== null ? minutesRange(w.startMinute, w.endMinute, lng) : null,
      w.positionId ? names.position?.(w.positionId) : null,
      w.facilityId ? names.facility?.(w.facilityId) : null,
    ]
      .filter(Boolean)
      .join(' ') || t('prefs.anyShift');
  const prefer = p.windows.filter((w) => w.kind === 'PREFER').map(describe);
  const avoid = p.windows.filter((w) => w.kind === 'AVOID').map(describe);
  if (prefer.length) out.push(t('prefs.summary.prefers', { what: prefer.join('; ') }));
  if (avoid.length) out.push(t('prefs.summary.avoids', { what: avoid.join('; ') }));
  if (p.maxWeeklyHours !== null) out.push(t('prefs.summary.maxHours', { hours: formatHours(p.maxWeeklyHours, lng) }));
  if (p.maxDaysPerWeek !== null) out.push(t('prefs.summary.maxDays', { count: p.maxDaysPerWeek }));
  return out;
}
