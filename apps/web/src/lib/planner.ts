/**
 * Scheduling by hand (the schedule builder's planner): shapes from the API and the pure helpers
 * the views use — periods, snapping, lanes, people filters, status lookup and the undo stack.
 * Statuses come from the API's batch eligibility check; nothing here decides who may work.
 */

export type View = 'month' | 'week' | 'day';
export const VIEWS: View[] = ['month', 'week', 'day'];
export type Status = 'ok' | 'warn' | 'block' | 'unknown';

export interface Named { id: string; name: string; nameFr: string | null }
export interface BoardShift {
  id: string;
  facilityId: string;
  positionId: string;
  userId: string | null;
  localStartsAt: string;
  localEndsAt: string;
  status: 'DRAFT' | 'PUBLISHED';
  shiftType: string;
  customTitle: string | null;
  conflictReason: string | null;
  version: number;
  hours: number;
  facility: { id: string; name: string; timezone: string };
  position: Named;
  assignee: { id: string; name: string } | null;
}
export interface BoardPerson {
  id: string;
  name: string;
  initials: string;
  employmentStatus: string;
  positionIds: string[];
  primaryPositionId: string | null;
  certifications: Named[];
  fromDepartment: { name: string; nameFr: string | null } | null;
  scheduledHours: number;
  targetHours: number | null;
  /** date → [startMinute, endMinute] windows */
  availability: Record<string, Array<[number, number]>>;
  timeOff: Record<string, Array<[number, number]>>;
  hasAvailability: boolean;
  confirmedThrough: string | null;
  availabilityCurrent: boolean;
}
export interface Board {
  range: { from: string; to: string; timezone: string; today: string };
  /** 'week': people's hours and targets are for the pay week around the day in view. */
  hoursScope?: 'week' | 'period';
  planAheadThrough: string;
  departments: Named[];
  positions: Named[];
  facilities: Array<{ id: string; name: string; timezone: string }>;
  people: BoardPerson[];
  shifts: BoardShift[];
  usual: Record<string, Array<{ start: string; end: string; count: number }>>;
}

export interface Reason { code: string; n?: number[]; at?: string; cert?: string }
/** People by index in `users`; warnings and refusals point at a reasons list in `reasons` (each sent once). */
export interface Cells { ok: number[]; warn: Array<[number, number]>; block: Array<[number, number]> }
export interface EligResponse { users: string[]; reasons: Reason[][]; shifts: Record<string, Cells>; days: Record<string, Cells>; evaluations: number; ms: number }
export interface Cell { status: Exclude<Status, 'unknown'>; reasons: Reason[] }
/** Per person: their cells per shift id and per day, once loaded. */
export type EligCache = Record<string, { shifts: Record<string, Cell>; days: Record<string, Cell> }>;

// ------------------------------------------------------------------ Dates and periods

export function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const mondayOf = (iso: string) => plusDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export const monthOf = (iso: string) => iso.slice(0, 7);

/** The days a view shows around a date: a month grid (whole weeks), a week, or one day. */
export function periodOf(view: View, anchor: string): { from: string; to: string; days: string[] } {
  let from: string;
  let n: number;
  if (view === 'day') {
    from = anchor;
    n = 1;
  } else if (view === 'week') {
    from = mondayOf(anchor);
    n = 7;
  } else {
    const first = `${anchor.slice(0, 7)}-01`;
    from = mondayOf(first);
    const next = plusDays(`${anchor.slice(0, 7)}-28`, 4).slice(0, 7);
    const last = plusDays(`${next}-01`, -1);
    n = Math.ceil((daysBetween(from, last) + 1) / 7) * 7;
  }
  return { from, to: plusDays(from, n), days: Array.from({ length: n }, (_, i) => plusDays(from, i)) };
}

/** The next or previous period. */
export function stepAnchor(view: View, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return plusDays(anchor, dir);
  if (view === 'week') return plusDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

/** Minutes after midnight of a facility-local ISO time ("2026-11-16T09:30:00.000-08:00" → 570). */
export function minuteOf(localIso: string): number {
  return Number(localIso.slice(11, 13)) * 60 + Number(localIso.slice(14, 16));
}
/** End minute, past 1440 when it ends on a later day. */
export function endMinuteOf(startIso: string, endIso: string): number {
  return minuteOf(endIso) + daysBetween(startIso.slice(0, 10), endIso.slice(0, 10)) * 1440;
}
export const hhmm = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((min % 60) + 60) % 60).padStart(2, '0')}`;
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ------------------------------------------------------------------ Timeline geometry

export const SNAP = 15;
/** Rounds to the nearest step (15 minutes). */
export const snap = (min: number, step = SNAP) => Math.round(min / step) * step;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Axis { startHour: number; endHour: number; pxPerHour: number }
export const axisWidth = (a: Axis) => (a.endHour - a.startHour) * a.pxPerHour;
export const minutesToX = (min: number, a: Axis) => ((min - a.startHour * 60) / 60) * a.pxPerHour;
export const xToMinutes = (x: number, a: Axis) => a.startHour * 60 + (x / a.pxPerHour) * 60;

/** Default 5:00–23:00, widened to fit any shift that day. */
export function axisFor(shifts: Array<Pick<BoardShift, 'localStartsAt' | 'localEndsAt'>>, pxPerHour: number): Axis {
  let lo = 5;
  let hi = 23;
  for (const s of shifts) {
    lo = Math.min(lo, Math.floor(minuteOf(s.localStartsAt) / 60));
    hi = Math.max(hi, Math.min(24, Math.ceil(endMinuteOf(s.localStartsAt, s.localEndsAt) / 60)));
  }
  return { startHour: lo, endHour: hi, pxPerHour };
}

/** Moves/resizes a [start, end] span by a pointer delta, snapped; keeps at least `min` minutes. */
export function dragSpan(span: [number, number], deltaMin: number, mode: 'move' | 'start' | 'end', bounds: [number, number], min = 30): [number, number] {
  const d = snap(deltaMin);
  const [s, e] = span;
  if (mode === 'move') {
    const len = e - s;
    const ns = clamp(s + d, bounds[0], bounds[1] - len);
    return [ns, ns + len];
  }
  if (mode === 'start') return [clamp(s + d, bounds[0], e - min), e];
  return [s, clamp(e + d, s + min, bounds[1])];
}

/** Packs overlapping bars into lanes (first lane that's free), stable by start time. */
export function lanes<T extends { id: string; start: number; end: number }>(items: T[]): { lane: Record<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const ends: number[] = [];
  const lane: Record<string, number> = {};
  for (const it of sorted) {
    let i = ends.findIndex((e) => e <= it.start);
    if (i < 0) {
      i = ends.length;
      ends.push(it.end);
    } else ends[i] = it.end;
    lane[it.id] = i;
  }
  return { lane, count: Math.max(1, ends.length) };
}

// ------------------------------------------------------------------ Rows

export type RowMode = 'position' | 'facility';
export interface Row { key: string; label: Named | { id: string; name: string; nameFr: null }; facilityId: string | null; positionId: string | null }

/** Rows for the week and day views: by position (or facility × position), or by facility. */
export function rowsOf(board: Pick<Board, 'positions' | 'facilities'>, mode: RowMode): Row[] {
  if (mode === 'facility') return board.facilities.map((f) => ({ key: `f:${f.id}`, label: { id: f.id, name: f.name, nameFr: null }, facilityId: f.id, positionId: null }));
  return board.positions.map((p) => ({ key: `p:${p.id}`, label: p, facilityId: null, positionId: p.id }));
}
export const inRow = (s: Pick<BoardShift, 'facilityId' | 'positionId'>, r: Row) => (r.facilityId === null || s.facilityId === r.facilityId) && (r.positionId === null || s.positionId === r.positionId);

// ------------------------------------------------------------------ People

export interface PeopleFilter { query: string; positionId: string; availableOn: string | null; underTarget: boolean }
export type PeopleSort = 'hours' | 'name';

export const isOffAllDay = (p: BoardPerson, date: string) => (p.timeOff[date] ?? []).some(([s, e]) => s <= 0 && e >= 1440);
export const isAvailableOn = (p: BoardPerson, date: string) => (p.availability[date]?.length ?? 0) > 0 && !isOffAllDay(p, date);
export const underTarget = (p: BoardPerson) => p.targetHours !== null && p.scheduledHours < p.targetHours;

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function filterPeople(people: BoardPerson[], f: PeopleFilter, sort: PeopleSort): BoardPerson[] {
  const q = fold(f.query.trim());
  const out = people.filter(
    (p) =>
      (!q || fold(p.name).includes(q)) &&
      (!f.positionId || p.positionIds.includes(f.positionId)) &&
      (!f.availableOn || isAvailableOn(p, f.availableOn)) &&
      (!f.underTarget || underTarget(p)),
  );
  return out.sort((a, b) => (sort === 'hours' ? a.scheduledHours - b.scheduledHours : 0) || a.name.localeCompare(b.name));
}

/** Hours bar: share of target (0–1, capped), or null when there's no target. */
export const hoursShare = (p: Pick<BoardPerson, 'scheduledHours' | 'targetHours'>) => (p.targetHours ? Math.min(1, p.scheduledHours / p.targetHours) : null);

/**
 * Times to suggest for a new shift for a person on a day: the department's usual shift for the
 * position that fits their availability, else their availability (2–12 h), else the usual shift,
 * else 9:00–17:00. When dropped at a time on the day view, starts there and keeps the length.
 */
export function suggestTimes(usual: Board['usual'], positionId: string, windows: Array<[number, number]> | undefined, at?: number): { start: number; end: number } {
  const spans = (usual[positionId] ?? []).map((u) => {
    const s = toMinutes(u.start);
    let e = toMinutes(u.end);
    if (e <= s) e += 1440;
    return [s, e] as [number, number];
  });
  const w = [...(windows ?? [])].sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  let span = spans.find(([s, e]) => w && s >= w[0] && e <= w[1]) ?? null;
  if (!span && w && w[1] - w[0] >= 120 && w[1] - w[0] <= 720) span = w;
  span ??= spans[0] ?? [540, 1020];
  if (at === undefined) return { start: span[0], end: span[1] };
  const len = span[1] - span[0];
  const start = snap(at);
  return { start, end: start + len };
}

/** The position a person would most likely work here: one asked for, else their main one, else their first. */
export function positionFor(p: Pick<BoardPerson, 'positionIds' | 'primaryPositionId'>, wanted: string | null): string | null {
  if (wanted && p.positionIds.includes(wanted)) return wanted;
  if (p.primaryPositionId && p.positionIds.includes(p.primaryPositionId)) return p.primaryPositionId;
  return p.positionIds[0] ?? null;
}

// ------------------------------------------------------------------ Eligibility cache

const NOT_QUALIFIED: Cell = { status: 'block', reasons: [{ code: 'NOT_QUALIFIED_FOR_POSITION' }] };

/** Folds one API response (a chunk of people) into the per-person cache. */
export function mergeElig(cache: EligCache, r: EligResponse): EligCache {
  const next: EligCache = { ...cache };
  // Every shift in the response was checked for these people: anyone without a cell isn't approved for it.
  for (const id of r.users) {
    const prev = cache[id];
    next[id] = { shifts: { ...(prev?.shifts ?? {}) }, days: { ...(prev?.days ?? {}) } };
    for (const s of Object.keys(r.shifts)) next[id]!.shifts[s] = NOT_QUALIFIED;
  }
  const fill = (target: 'shifts' | 'days', key: string, cells: Cells) => {
    for (const i of cells.ok) next[r.users[i]!]![target][key] = { status: 'ok', reasons: [] };
    for (const [i, ref] of cells.warn) next[r.users[i]!]![target][key] = { status: 'warn', reasons: r.reasons[ref] ?? [] };
    for (const [i, ref] of cells.block) next[r.users[i]!]![target][key] = { status: 'block', reasons: r.reasons[ref] ?? [] };
  };
  for (const [id, cells] of Object.entries(r.shifts)) fill('shifts', id, cells);
  for (const [d, cells] of Object.entries(r.days)) fill('days', d, cells);
  return next;
}

const UNKNOWN = { status: 'unknown' as const, reasons: [] as Reason[] };
export type MaybeCell = Cell | typeof UNKNOWN;

/** A person's status for a shift; unknown until that person and shift have been checked. */
export function shiftStatus(cache: EligCache, userId: string, shiftId: string): Cell | typeof UNKNOWN {
  return cache[userId]?.shifts[shiftId] ?? UNKNOWN;
}
export function dayStatus(cache: EligCache, userId: string, date: string): Cell | typeof UNKNOWN {
  const p = cache[userId];
  if (!p) return UNKNOWN;
  return p.days[date] ?? UNKNOWN;
}

/** Worst first: what a group of people dropped together would hit. */
export function combine(cells: Array<Cell | typeof UNKNOWN>): Cell | typeof UNKNOWN {
  const rank = { block: 3, warn: 2, unknown: 1, ok: 0 } as const;
  return cells.reduce<Cell | typeof UNKNOWN>((w, c) => (rank[c.status] > rank[w.status] ? c : w), { status: 'ok', reasons: [] });
}

/** Ranked people for a shift: ok, then warnings, then unknown, then refused; fewer hours first. */
export function rankFor(people: BoardPerson[], cache: EligCache, shiftId: string): Array<{ person: BoardPerson; cell: Cell | typeof UNKNOWN }> {
  const order = { ok: 0, warn: 1, unknown: 2, block: 3 } as const;
  return people
    .map((person) => ({ person, cell: shiftStatus(cache, person.id, shiftId) }))
    .sort((a, b) => order[a.cell.status] - order[b.cell.status] || a.person.scheduledHours - b.person.scheduledHours || a.person.name.localeCompare(b.person.name));
}

/** Tone for a status (colour is never alone: the reason text goes with it). */
export const toneOf = (s: Status): 'ok' | 'warn' | 'danger' | 'neutral' => (s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'block' ? 'danger' : 'neutral');

/** People to check first: those shown at the top of the panel, then everyone else, in chunks. */
export function chunksToLoad(order: string[], loaded: ReadonlySet<string>, size = 20): string[][] {
  const todo = order.filter((id) => !loaded.has(id));
  const out: string[][] = [];
  for (let i = 0; i < todo.length; i += size) out.push(todo.slice(i, i + size));
  return out;
}

// ------------------------------------------------------------------ Undo / redo

/** A change made in this session, with what undoes it. Ids of shifts re-created by redo are remapped. */
export type Op =
  | { kind: 'create'; ids: string[]; body: CreateBody; label: string }
  | { kind: 'assign'; shiftId: string; from: string | null; to: string | null; label: string }
  | { kind: 'move'; shiftId: string; from: MoveBody; to: MoveBody; label: string }
  | { kind: 'copy'; ids: string[]; body: Record<string, unknown>; label: string }
  | { kind: 'group'; ops: Op[]; label: string };

export interface CreateBody { facilityId: string; positionId: string; startsAt: string; endsAt: string; userIds: string[]; shiftType?: string; customTitle?: string | null; acknowledgeOvertime?: boolean }
export interface MoveBody { startsAt: string; endsAt: string; positionId: string; facilityId: string; userId: string | null }

export interface History { past: Op[]; future: Op[] }
export const emptyHistory = (): History => ({ past: [], future: [] });
export const LIMIT = 100;

export function record(h: History, op: Op): History {
  return { past: [...h.past, op].slice(-LIMIT), future: [] };
}
/** Takes the last change off for undoing; it moves to the redo list. */
export function undo(h: History): { op: Op | null; history: History } {
  const op = h.past[h.past.length - 1];
  if (!op) return { op: null, history: h };
  return { op, history: { past: h.past.slice(0, -1), future: [op, ...h.future] } };
}
export function redo(h: History): { op: Op | null; history: History } {
  const op = h.future[0];
  if (!op) return { op: null, history: h };
  return { op, history: { past: [...h.past, op], future: h.future.slice(1) } };
}
/** After a redo re-creates shifts, later changes refer to the new ids. */
export function remap(h: History, from: string[], to: string[]): History {
  const m = new Map(from.map((id, i) => [id, to[i] ?? id]));
  const fix = (op: Op): Op => {
    if (op.kind === 'group') return { ...op, ops: op.ops.map(fix) };
    if (op.kind === 'create' || op.kind === 'copy') return { ...op, ids: op.ids.map((id) => m.get(id) ?? id) };
    return { ...op, shiftId: m.get(op.shiftId) ?? op.shiftId };
  };
  return { past: h.past.map(fix), future: h.future.map(fix) };
}

// ------------------------------------------------------------------ Coverage

/** Staff on shift per hour in a row, to compare with the forecast's suggested staff. */
export function staffedByHour(shifts: Array<Pick<BoardShift, 'localStartsAt' | 'localEndsAt' | 'userId'>>, axis: Axis): number[] {
  const out: number[] = [];
  for (let h = axis.startHour; h < axis.endHour; h++) {
    out.push(shifts.filter((s) => s.userId && minuteOf(s.localStartsAt) < (h + 1) * 60 && endMinuteOf(s.localStartsAt, s.localEndsAt) > h * 60).length);
  }
  return out;
}

/** Remembered view, per user, with storage that may not be there. */
export function readView(userId: string | undefined): View | null {
  try {
    const v = localStorage.getItem(`fh.planner.view.${userId ?? 'anon'}`);
    return v === 'month' || v === 'week' || v === 'day' ? v : null;
  } catch {
    return null;
  }
}
export function saveView(userId: string | undefined, v: View) {
  try {
    localStorage.setItem(`fh.planner.view.${userId ?? 'anon'}`, v);
  } catch {
    /* private window: fine */
  }
}
