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
  statHoliday?: boolean;
  /** A forecast shift not created yet (the slot id starts with "new:"): accepting creates it. */
  newShift?: { startsAt: string; endsAt: string } | null;
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
  carry: CarryItem[];
}
export interface CarryItem { shiftId: string; userId: string; startsAt?: string; endsAt?: string; positionId?: string; facilityId?: string }
/** A forecast shift to propose (nothing is created until it's accepted). */
export interface NewShift { key: string; facilityId: string; positionId: string; startsAt: string; endsAt: string }
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

export type AcceptBody =
  | { shiftId: string; userId: string; expectedVersion: number; previousUserId: string | null }
  | { newShift: { facilityId: string; positionId: string; startsAt: string; endsAt: string }; key: string; userId: string | null };

/** One item's accept request: an existing draft, or a forecast shift to create (open when userId is null). */
export function acceptItem(slot: FillSlot, userId: string | null): AcceptBody {
  if (slot.newShift) return { newShift: { facilityId: slot.facilityId, positionId: slot.positionId, startsAt: slot.newShift.startsAt, endsAt: slot.newShift.endsAt }, key: slot.id, userId };
  return { shiftId: slot.id, userId: userId!, expectedVersion: slot.version, previousUserId: slot.currentUserId };
}

/** The slot id an accept request is for. */
export const slotIdOf = (b: AcceptBody) => ('shiftId' in b ? b.shiftId : b.key);

/** What to send to accept the chosen items (those not declined or already accepted). */
export function acceptBody(items: Item[], r: ReviewState): AcceptBody[] {
  return items.filter((i) => i.proposal && !r.declined[i.slot.id] && !r.accepted[i.slot.id]).map((i) => acceptItem(i.slot, r.choice[i.slot.id] ?? i.proposal!.userId));
}

/**
 * Undo works one accept at a time, latest first: each entry remembers its undo ids (one per week
 * accepted) and which items it accepted, so undoing it un-marks only those.
 */
export interface UndoEntry { undoIds: string[]; slotIds: string[] }
export function pushUndo(stack: UndoEntry[], e: UndoEntry): UndoEntry[] {
  return e.undoIds.length ? [...stack, e] : stack;
}
export function popUndo(stack: UndoEntry[], r: ReviewState): { stack: UndoEntry[]; entry: UndoEntry | null; review: ReviewState } {
  const entry = stack.at(-1) ?? null;
  if (!entry) return { stack, entry, review: r };
  const accepted = { ...r.accepted };
  const handled = { ...r.handled };
  for (const id of entry.slotIds) {
    delete accepted[id];
    delete handled[id];
  }
  return { stack: stack.slice(0, -1), entry, review: { ...r, accepted, handled } };
}

/** The people named anywhere in the run. */
export function peopleOf(weeks: FillWeek[]): Record<string, FillPerson> {
  return Object.assign({}, ...weeks.map((w) => w.people));
}
