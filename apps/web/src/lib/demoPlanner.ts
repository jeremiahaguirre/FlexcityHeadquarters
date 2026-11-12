/**
 * The schedule builder in the static demo: the recorded board (a few weeks around the capture
 * day) plus what the visitor changed in this tab — drafts made by hand, people assigned, shifts
 * moved, copied, cancelled or published, and Fill the schedule's accepted proposals. Kept in
 * sessionStorage like the shift board simulation; nothing leaves the browser.
 *
 * Only a sketch of the rules runs here (the position and double-booking); the real API checks
 * everything (availability, rest, overtime, certifications) and is what decides.
 */
import { ApiError } from './apiError';
import type { Board, BoardShift } from './planner';
import type { FillWeek } from './fill';

export interface PlanState {
  /** Recorded shifts as changed here, by id. */
  edits: Record<string, BoardShift>;
  /** Shifts made here. */
  added: BoardShift[];
  /** Cancelled here. */
  removed: string[];
  /** Fill the schedule accepts: undo id → what each shift was before (null: made by the accept). */
  undo: Record<string, Array<{ id: string; userId: string | null } | { id: string; created: true }>>;
}

const KEY = 'flexcity-demo-plan';
export const emptyPlan = (): PlanState => ({ edits: {}, added: [], removed: [], undo: {} });

export function loadPlan(): PlanState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { ...emptyPlan(), ...(JSON.parse(raw) as PlanState) };
  } catch {
    /* storage unavailable */
  }
  return emptyPlan();
}
export function savePlan(p: PlanState | null) {
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* the change still shows until the page reloads */
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const H = 3_600_000;

/** An instant as the facility's wall-clock time with its offset, like the API's localStartsAt. */
export function localIso(instant: string | Date, timeZone: string): string {
  const d = new Date(instant);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const off = Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (iso: string) => plusDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const dayOf = (s: BoardShift) => s.localStartsAt.slice(0, 10);
const startOf = (s: BoardShift) => Date.parse(s.localStartsAt);
const endOf = (s: BoardShift) => Date.parse(s.localEndsAt);

/** Every shift as it stands in this tab. */
export function shiftsOf(base: Board, p: PlanState): BoardShift[] {
  const gone = new Set(p.removed);
  return [...base.shifts.map((s) => p.edits[s.id] ?? s), ...p.added].filter((s) => !gone.has(s.id)).sort((a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id));
}

function put(p: PlanState, s: BoardShift): PlanState {
  if (p.added.some((x) => x.id === s.id)) return { ...p, added: p.added.map((x) => (x.id === s.id ? s : x)) };
  return { ...p, edits: { ...p.edits, [s.id]: s } };
}

/** The board for the requested days (and facility), with people's hours counted from the shifts as they stand. */
export function boardFor(base: Board, p: PlanState, from: string, to: string, facilityIds?: string[]): Board {
  const all = shiftsOf(base, p);
  const days = Math.max(1, daysBetween(from, to));
  const weekScope = days < 7;
  const hFrom = weekScope ? mondayOf(from) : from;
  const hTo = weekScope ? plusDays(hFrom, 7) : to;
  const baseWeeks = Math.max(1, daysBetween(base.range.from, base.range.to)) / 7;
  const baseWeekly = base.hoursScope === 'week';
  const facilities = facilityIds?.length ? new Set(facilityIds) : null;
  const people = base.people.map((person) => {
    const scheduled = all.filter((s) => s.userId === person.id && dayOf(s) >= hFrom && dayOf(s) < hTo).reduce((n, s) => n + s.hours, 0);
    const weekly = person.targetHours === null ? null : person.targetHours / (baseWeekly ? 1 : baseWeeks);
    return { ...person, scheduledHours: Math.round(scheduled * 100) / 100, targetHours: weekly === null ? null : Math.round(weekly * (weekScope ? 1 : days / 7) * 100) / 100 };
  });
  return {
    ...base,
    range: { ...base.range, from, to },
    hoursScope: weekScope ? 'week' : 'period',
    facilities: facilities ? base.facilities.filter((f) => facilities.has(f.id)) : base.facilities,
    people,
    shifts: all.filter((s) => dayOf(s) >= from && dayOf(s) < to && (!facilities || facilities.has(s.facilityId))),
  };
}

const refuse = (code: string) => new ApiError(422, 'NOT_ELIGIBLE', 'Not eligible for this shift.', { blocks: [{ code }] });

/** The two checks the demo can make: the person holds the position and isn't already working then. */
function check(base: Board, p: PlanState, s: BoardShift, userId: string) {
  const person = base.people.find((x) => x.id === userId);
  if (!person) throw new ApiError(404, 'NOT_FOUND', 'Person not found.');
  if (!person.positionIds.includes(s.positionId)) throw refuse('NOT_QUALIFIED_FOR_POSITION');
  if (shiftsOf(base, p).some((o) => o.id !== s.id && o.userId === userId && startOf(o) < endOf(s) && endOf(o) > startOf(s))) throw refuse('OVERLAPPING_SHIFT');
}

const nameOf = (base: Board, userId: string | null) => {
  const person = base.people.find((x) => x.id === userId);
  return person ? { id: person.id, name: person.name } : null;
};

function withUser(base: Board, s: BoardShift, userId: string | null): BoardShift {
  return { ...s, userId, assignee: nameOf(base, userId), version: s.version + 1 };
}

function find(base: Board, p: PlanState, id: string): BoardShift {
  const s = shiftsOf(base, p).find((x) => x.id === id);
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Shift not found.');
  return s;
}

export function assign(base: Board, p: PlanState, id: string, userId: string | null): PlanState {
  const s = find(base, p, id);
  const next = withUser(base, s, userId);
  if (userId) check(base, p, next, userId);
  return put(p, next);
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, '0').slice(-12)}`);

/** A shift made here, shaped like the API's (break from another shift of the same position). */
function make(base: Board, p: PlanState, b: { facilityId: string; positionId: string; startsAt: string; endsAt: string; userId: string | null; customTitle?: string | null; shiftType?: string }): BoardShift {
  const facility = base.facilities.find((f) => f.id === b.facilityId) ?? base.facilities[0]!;
  const position = base.positions.find((x) => x.id === b.positionId) ?? base.positions[0]!;
  const like = shiftsOf(base, p).find((x) => x.positionId === position.id && x.ownBreakMinutes == null);
  const length = (Date.parse(b.endsAt) - Date.parse(b.startsAt)) / H;
  const breakMinutes = length > 5 ? (like?.unpaidBreakMinutes ?? 0) : 0;
  return {
    id: newId(),
    facilityId: facility.id,
    positionId: position.id,
    userId: b.userId,
    localStartsAt: localIso(b.startsAt, facility.timezone),
    localEndsAt: localIso(b.endsAt, facility.timezone),
    status: 'DRAFT',
    shiftType: b.shiftType ?? 'STANDARD',
    customTitle: b.customTitle ?? null,
    conflictReason: null,
    version: 0,
    hours: Math.round((length - breakMinutes / 60) * 100) / 100,
    unpaidBreakMinutes: breakMinutes,
    ownBreakMinutes: null,
    neverAlone: like?.neverAlone ?? false,
    ownNeverAlone: null,
    callBack: false,
    warnings: [],
    facility: { id: facility.id, name: facility.name, timezone: facility.timezone },
    position: { id: position.id, name: position.name, nameFr: position.nameFr },
    assignee: nameOf(base, b.userId),
  };
}

function add(base: Board, p: PlanState, s: BoardShift): PlanState {
  if (s.userId) check(base, p, s, s.userId);
  return { ...p, added: [...p.added, s] };
}

export interface CreateBody { facilityId: string; positionId: string; startsAt: string; endsAt: string; userIds?: string[]; customTitle?: string | null; shiftType?: string }

/** New drafts: one open shift, or one per person. */
export function create(base: Board, p: PlanState, b: CreateBody): { plan: PlanState; ids: string[] } {
  if (!(Date.parse(b.endsAt) > Date.parse(b.startsAt))) throw new ApiError(400, 'VALIDATION', 'The shift has to end after it starts.');
  let plan = p;
  const ids: string[] = [];
  for (const userId of b.userIds?.length ? b.userIds : [null]) {
    const s = make(base, plan, { ...b, userId });
    plan = add(base, plan, s);
    ids.push(s.id);
  }
  return { plan, ids };
}

export interface MoveBody { startsAt?: string; endsAt?: string; positionId?: string; facilityId?: string; userId?: string | null; copy?: boolean }

/** Drag to another time, day, person or position; with copy, a new draft and the original stays. */
export function move(base: Board, p: PlanState, id: string, b: MoveBody): { plan: PlanState; id: string; created: boolean } {
  const s = find(base, p, id);
  const facility = base.facilities.find((f) => f.id === (b.facilityId ?? s.facilityId)) ?? s.facility;
  const startsAt = b.startsAt ?? new Date(s.localStartsAt).toISOString();
  const endsAt = b.endsAt ?? new Date(s.localEndsAt).toISOString();
  const userId = b.userId !== undefined ? b.userId : s.userId;
  if (b.copy) {
    const c = make(base, p, { facilityId: facility.id, positionId: b.positionId ?? s.positionId, startsAt, endsAt, userId, customTitle: s.customTitle, shiftType: s.shiftType });
    return { plan: add(base, p, c), id: c.id, created: true };
  }
  const position = base.positions.find((x) => x.id === (b.positionId ?? s.positionId)) ?? s.position;
  const hours = Math.round(((Date.parse(endsAt) - Date.parse(startsAt)) / H - (s.unpaidBreakMinutes ?? 0) / 60) * 100) / 100;
  const next: BoardShift = {
    ...withUser(base, s, userId),
    facilityId: facility.id,
    facility: { id: facility.id, name: facility.name, timezone: facility.timezone },
    positionId: position.id,
    position: { id: position.id, name: position.name, nameFr: position.nameFr },
    localStartsAt: localIso(startsAt, facility.timezone),
    localEndsAt: localIso(endsAt, facility.timezone),
    hours,
  };
  if (userId) check(base, p, next, userId);
  return { plan: put(p, next), id: s.id, created: false };
}

/** Several people onto one shift: the first takes it if it's open, the others get copies. */
export function assignMany(base: Board, p: PlanState, id: string, userIds: string[]) {
  const s = find(base, p, id);
  let plan = p;
  const results: Array<{ userId: string; shiftId: string | null; code: string | null }> = [];
  for (const userId of userIds) {
    try {
      if (!s.userId && !results.some((r) => r.shiftId === s.id)) {
        plan = assign(base, plan, s.id, userId);
        results.push({ userId, shiftId: s.id, code: null });
      } else {
        const r = move(base, plan, s.id, { userId, copy: true });
        plan = r.plan;
        results.push({ userId, shiftId: r.id, code: null });
      }
    } catch (e) {
      const code = e instanceof ApiError ? ((e.details as { blocks?: Array<{ code: string }> })?.blocks?.[0]?.code ?? e.code) : 'NOT_ELIGIBLE';
      results.push({ userId, shiftId: null, code });
    }
  }
  return { plan, results };
}

export function cancel(base: Board, p: PlanState, ids: string[]): PlanState {
  const mine = new Set(p.added.map((s) => s.id));
  return { ...p, added: p.added.filter((s) => !ids.includes(s.id)), removed: [...new Set([...p.removed, ...ids.filter((id) => !mine.has(id))])] };
}

/** Copy last week (days 7) or yesterday (days 1) onto the period starting `to`; matching shifts already there are skipped. */
export function copyRange(base: Board, p: PlanState, b: { from: string; to: string; days: number; withPeople?: boolean; facilityIds?: string[] }) {
  const offset = daysBetween(b.from, b.to);
  const all = shiftsOf(base, p).filter((s) => !b.facilityIds?.length || b.facilityIds.includes(s.facilityId));
  const inRange = (s: BoardShift, from: string) => dayOf(s) >= from && dayOf(s) < plusDays(from, b.days);
  const taken = new Map<string, number>();
  for (const s of all.filter((x) => inRange(x, b.to))) {
    const k = `${s.facilityId}|${s.positionId}|${startOf(s)}|${endOf(s)}`;
    taken.set(k, (taken.get(k) ?? 0) + 1);
  }
  let plan = p;
  const created: string[] = [];
  const leftOpen: Array<{ shiftId: string; userId: string; code: string }> = [];
  let assigned = 0;
  let skippedExisting = 0;
  for (const s of all.filter((x) => inRange(x, b.from))) {
    const startsAt = new Date(startOf(s) + offset * 86_400_000).toISOString();
    const endsAt = new Date(endOf(s) + offset * 86_400_000).toISOString();
    const k = `${s.facilityId}|${s.positionId}|${Date.parse(startsAt)}|${Date.parse(endsAt)}`;
    if ((taken.get(k) ?? 0) > 0) {
      taken.set(k, taken.get(k)! - 1);
      skippedExisting++;
      continue;
    }
    const c = make(base, plan, { facilityId: s.facilityId, positionId: s.positionId, startsAt, endsAt, userId: null, customTitle: s.customTitle, shiftType: s.shiftType });
    plan = add(base, plan, c);
    created.push(c.id);
    if (b.withPeople !== false && s.userId) {
      try {
        plan = assign(base, plan, c.id, s.userId);
        assigned++;
      } catch {
        leftOpen.push({ shiftId: c.id, userId: s.userId, code: 'OVERLAPPING_SHIFT' });
      }
    }
  }
  return { plan, created, assigned, leftOpen, skippedExisting };
}

/** Publish the drafts of one facility in a time range (or just the ones listed). */
export function publish(base: Board, p: PlanState, b: { facilityId: string; from: string; to: string; shiftIds?: string[] }) {
  const from = Date.parse(b.from);
  const to = Date.parse(b.to);
  const ids = b.shiftIds?.length ? new Set(b.shiftIds) : null;
  const drafts = shiftsOf(base, p).filter((s) => s.status === 'DRAFT' && s.facilityId === b.facilityId && startOf(s) >= from && startOf(s) < to && (!ids || ids.has(s.id)));
  let plan = p;
  for (const s of drafts) plan = put(plan, { ...s, status: 'PUBLISHED', version: s.version + 1 });
  return { plan, published: drafts.length, postedToBoard: drafts.filter((s) => !s.userId).length };
}

/** What the publish check finds in the demo: nothing to warn about. */
export const publishCheck = () => ({ gaps: [], ineligible: [], federalNotice: null, twoPerson: [], postingNotice: null, breaks: 0, shortShifts: 0 });

/** A recorded Fill the schedule week, brought up to date with what was changed here. */
export function fillWeek(base: Board, p: PlanState, w: FillWeek): FillWeek {
  const now = new Map(shiftsOf(base, p).map((s) => [s.id, s]));
  const gone = (id: string) => !id.startsWith('new:') && !now.has(id);
  const taken = (id: string, recorded: string | null) => {
    const s = now.get(id);
    return !!s && s.userId !== recorded && !!s.userId;
  };
  const slots = w.slots.filter((s) => !gone(s.id)).map((s) => (now.has(s.id) ? { ...s, currentUserId: now.get(s.id)!.userId, version: now.get(s.id)!.version } : s));
  const drop = new Set(w.slots.filter((s) => gone(s.id) || taken(s.id, s.currentUserId)).map((s) => s.id));
  return { ...w, slots, proposals: w.proposals.filter((x) => !drop.has(x.slotId)), unfilled: w.unfilled.filter((x) => !drop.has(x.slotId)) };
}

type AcceptItem = { shiftId: string; userId: string } | { newShift: { facilityId: string; positionId: string; startsAt: string; endsAt: string }; key: string; userId: string | null };

/** Accept proposals: assign existing drafts, create forecast shifts. One undo id per accept. */
export function fillAccept(base: Board, p: PlanState, items: AcceptItem[]) {
  let plan = p;
  const skipped: Array<{ shiftId: string; code: string }> = [];
  const created: Array<{ key: string; shiftId: string }> = [];
  const before: PlanState['undo'][string] = [];
  for (const it of items) {
    try {
      if ('shiftId' in it) {
        const prev = find(base, plan, it.shiftId).userId;
        plan = assign(base, plan, it.shiftId, it.userId);
        before.push({ id: it.shiftId, userId: prev });
      } else {
        const r = create(base, plan, { ...it.newShift, userIds: it.userId ? [it.userId] : [] });
        plan = r.plan;
        created.push({ key: it.key, shiftId: r.ids[0]! });
        before.push({ id: r.ids[0]!, created: true });
      }
    } catch (e) {
      const code = e instanceof ApiError ? ((e.details as { blocks?: Array<{ code: string }> })?.blocks?.[0]?.code ?? e.code) : 'NOT_ELIGIBLE';
      skipped.push({ shiftId: 'shiftId' in it ? it.shiftId : it.key, code });
    }
  }
  const undoId = newId();
  plan = { ...plan, undo: { ...plan.undo, [undoId]: before } };
  return { plan, applied: before.length, skipped, undoIds: before.length ? [undoId] : [], created };
}

export function fillUndo(base: Board, p: PlanState, undoIds: string[]) {
  let plan = p;
  let restored = 0;
  for (const u of undoIds) {
    for (const x of [...(plan.undo[u] ?? [])].reverse()) {
      if ('created' in x) plan = cancel(base, plan, [x.id]);
      else plan = put(plan, withUser(base, find(base, plan, x.id), x.userId));
      restored++;
    }
    const { [u]: _gone, ...rest } = plan.undo;
    plan = { ...plan, undo: rest };
  }
  return { plan, restored, leftOpen: 0 };
}
