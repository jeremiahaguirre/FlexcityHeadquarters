/** "Fill the schedule": shapes from the API and the pure helpers the review uses. */
/** ISO date plus days (UTC arithmetic, no time zone involved). */
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const HORIZONS = [1, 2, 4, 13] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface Why { code: string; params?: Record<string, string | number> }
export interface FillProposal {
  slotId: string;
  userId: string;
  previousUserId: string | null;
  hoursBefore: number;
  weekHours: number;
  overtimeHours: number;
  tentative: boolean;
  reasons: Why[];
  alternatives: Array<{ userId: string; hoursBefore: number; overtimeHours: number; reasons: Why[] }>;
}
export interface FillUnfilled { slotId: string; qualified: number; counts: Array<{ code: string; count: number }>; overtimeOption: { userId: string; overtimeHours: number } | null }
export interface FillSlot {
  id: string;
  version: number;
  facilityId: string;
  facilityName: string;
  positionId: string;
  position: { name: string; nameFr: string | null };
  customTitle: string | null;
  localStartsAt: string;
  localEndsAt: string;
  hours: number;
  currentUserId: string | null;
  tentative: boolean;
}
export interface FillPerson { name: string; fromDepartment: { name: string; nameFr: string | null } | null }
export interface FillWeek {
  week: { start: string; index: number; tentative: boolean; beyondWindowFrom: string };
  settings: { useSeniority: boolean; toggles: Toggles; planAheadWeeks: Horizon };
  summary: { slots: number; filled: number; overtimeHours: number; overtimeCost: number; hours: { stdev: number }; ms: number };
  proposals: FillProposal[];
  unfilled: FillUnfilled[];
  coverageGaps: Array<{ needId: string; name: string; shortHours: number }>;
  slots: FillSlot[];
  people: Record<string, FillPerson>;
  carry: Array<{ shiftId: string; userId: string }>;
}
export interface Toggles { keepAssigned: boolean; avoidOvertime: boolean; spreadWeekends: boolean; sameFacility: boolean }
export interface Weights { fairness: number; overtime: number; continuity: number; targetHours: number; spread: number; preferences: number; seniority: number }
export const WEIGHT_KEYS: Array<keyof Weights> = ['fairness', 'targetHours', 'overtime', 'spread', 'continuity', 'preferences', 'seniority'];

export interface FillOptions {
  departments: Array<{ id: string; name: string; nameFr: string | null; own: boolean; positionIds: string[]; planAheadWeeks: Horizon; useSeniority?: boolean }>;
  defaultDepartmentId: string | null;
  canAll: boolean;
  facilities: Array<{ id: string; name: string; timezone: string }>;
  lastHorizonWeeks: Horizon | null;
  settings: { planAheadWeeks: Horizon; weights: Weights; toggles: Toggles; useSeniority: boolean };
  seniorityOn: boolean;
  canConfigureOrganization: boolean;
}

/** The week starts in a horizon. */
export function weeksOf(start: string, n: Horizon): string[] {
  return Array.from({ length: n }, (_, i) => plusDays(start, i * 7));
}

/** A horizon longer than the plan-ahead window: later weeks use people's usual weekly availability. */
export const beyondWindow = (horizon: Horizon, planAhead: Horizon) => horizon > planAhead;

export interface Item {
  slot: FillSlot;
  week: string;
  day: string;
  proposal: FillProposal | null;
  unfilled: FillUnfilled | null;
}

/** Every slot of every week, in time order, with its proposal or why it's open. */
export function itemsOf(weeks: FillWeek[]): Item[] {
  const out: Item[] = [];
  for (const w of weeks) {
    for (const slot of w.slots) {
      const proposal = w.proposals.find((p) => p.slotId === slot.id) ?? null;
      const unfilled = w.unfilled.find((u) => u.slotId === slot.id) ?? null;
      if (!proposal && !unfilled) continue; // kept as it was
      out.push({ slot, week: w.week.start, day: slot.localStartsAt.slice(0, 10), proposal, unfilled });
    }
  }
  return out.sort((a, b) => a.slot.localStartsAt.localeCompare(b.slot.localStartsAt) || a.slot.id.localeCompare(b.slot.id));
}

/** Week → day → items, keeping time order. */
export function grouped(items: Item[]): Array<{ week: string; days: Array<{ day: string; items: Item[] }> }> {
  const weeks: Array<{ week: string; days: Array<{ day: string; items: Item[] }> }> = [];
  for (const it of items) {
    let w = weeks.find((x) => x.week === it.week);
    if (!w) weeks.push((w = { week: it.week, days: [] }));
    let d = w.days.find((x) => x.day === it.day);
    if (!d) w.days.push((d = { day: it.day, items: [] }));
    d.items.push(it);
  }
  return weeks;
}

export interface ReviewState { choice: Record<string, string>; declined: Record<string, true>; accepted: Record<string, true>; handled: Record<string, true> }
export const emptyReview = (): ReviewState => ({ choice: {}, declined: {}, accepted: {}, handled: {} });

/** The plain-language summary: filled X of Y, overtime, how many need a person's attention. */
export function summarize(weeks: FillWeek[], items: Item[], r: ReviewState) {
  const total = items.length;
  const filled = items.filter((i) => i.proposal && !r.declined[i.slot.id]).length;
  const needYou = items.filter((i) => (i.unfilled && !r.handled[i.slot.id]) || (i.proposal && r.declined[i.slot.id])).length;
  const overtimeHours = Math.round(weeks.reduce((s, w) => s + w.summary.overtimeHours, 0) * 100) / 100;
  const overtimeCost = Math.round(weeks.reduce((s, w) => s + w.summary.overtimeCost, 0) * 100) / 100;
  const tentative = items.filter((i) => i.proposal?.tentative && !r.declined[i.slot.id]).length;
  return { total, filled, needYou, overtimeHours, overtimeCost, tentative };
}

/** What to send to accept the chosen items (those not declined or already accepted). */
export function acceptBody(items: Item[], r: ReviewState) {
  return items
    .filter((i) => i.proposal && !r.declined[i.slot.id] && !r.accepted[i.slot.id])
    .map((i) => ({ shiftId: i.slot.id, userId: r.choice[i.slot.id] ?? i.proposal!.userId, expectedVersion: i.slot.version, previousUserId: i.slot.currentUserId }));
}

/** The people named anywhere in the run. */
export function peopleOf(weeks: FillWeek[]): Record<string, FillPerson> {
  return Object.assign({}, ...weeks.map((w) => w.people));
}
