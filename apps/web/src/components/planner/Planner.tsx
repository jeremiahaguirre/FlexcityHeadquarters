'use client';

/**
 * Scheduling by hand: a people panel of availability cards beside a month, week or day view.
 * Drag people onto shifts or empty days, drag shifts to move or copy them (Alt/Option or the Copy
 * switch), drag their edges on the day view to change the times, drag a shift back to the panel
 * to unassign. While dragging, every target shows the API's verdict for those people (green,
 * amber with the reason, red with the reason); each drop is re-checked by the API. Phones and
 * keyboards do the same by picking: choose a shift for a ranked list of people, or pick a person
 * and then a shift or a day. Every change is a draft until Publish, and can be undone.
 */
import { CalendarDays, CalendarCog, ChevronLeft, ChevronRight, Copy, Redo2, Send, Undo2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { FillOptions } from '@/lib/fill';
import { formatDate, formatTimeRange } from '@/lib/format';
import {
  type Board,
  type BoardShift,
  type EligCache,
  type EligResponse,
  type History,
  type MoveBody,
  type Op,
  type RowMode,
  type View,
  VIEWS,
  chunksToLoad,
  combine,
  dayStatus,
  dragSpan,
  emptyHistory,
  endMinuteOf,
  hhmm,
  mergeElig,
  minuteOf,
  periodOf,
  plusDays,
  positionFor,
  readView,
  record,
  redo as redoStep,
  remap,
  rowsOf,
  saveView,
  shiftStatus,

  stepAnchor,
  suggestTimes,
  undo as undoStep,
} from '@/lib/planner';
import { useSession } from '@/lib/session';
import { zonedToInstant } from '@/lib/tz';
import { todayIso } from '@/lib/useQuery';
import { AssignSheet } from './AssignSheet';
import { type BarPreview, DayView } from './DayView';
import { type DragItem, type PointerInfo, type Target, coarsePointer, targetKey, useDrag } from './drag';
import { PeoplePanel } from './PeoplePanel';
import { type CreateRequest, type Draft, QuickCreate } from './QuickCreate';
import { ShiftDialog } from './ShiftDialog';
import { type PublishGroup, PublishDialog } from '@/components/PublishDialog';
import { GeneratePanel } from '@/components/scheduling/Rotations';
import type { ChangeEffect, ChangePreview } from '@/lib/workRules';
import { reasonsFromError, reasonsText } from './text';
import { MonthView, WeekView, posLabel } from './views';

export const pxPerHourFor = (width: number) => (width < 640 ? 48 : 64);
const CHUNK = 20;

export function Planner({ onOpenFill, refreshKey }: { onOpenFill: () => void; refreshKey: number }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const { me } = useSession();
  const [options, setOptions] = useState<FillOptions | null>(null);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [view, setViewState] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => todayIso());
  const [rowMode, setRowMode] = useState<RowMode>('position');
  const [focusDay, setFocusDay] = useState(() => todayIso());

  useEffect(() => {
    const v = readView(me?.id);
    if (v) setViewState(v);
  }, [me?.id]);
  const setView = (v: View) => {
    setViewState(v);
    saveView(me?.id, v);
  };

  useEffect(() => {
    api<FillOptions>('/api/schedule/fill/options')
      .then((o) => {
        setOptions(o);
        setDepartmentId((d) => d || o.defaultDepartmentId || o.departments[0]?.id || '');
      })
      .catch((e: Error) => setOptionsError(e));
  }, []);

  const period = useMemo(() => periodOf(view, anchor), [view, anchor]);
  const path = departmentId ? `/api/schedule/planner?departmentId=${departmentId}&from=${period.from}&to=${period.to}${facilityId ? `&facilityIds=${facilityId}` : ''}` : null;
  const pathRef = useRef(path);
  pathRef.current = path;
  const [board, setBoard] = useState<Board | null>(null);
  const [boardError, setBoardError] = useState<Error | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const loadBoard = useCallback(async (): Promise<Board | null> => {
    const p = pathRef.current;
    if (!p) return null;
    try {
      const b = await api<Board>(p);
      if (pathRef.current !== p) return null;
      setBoard(b);
      setBoardError(null);
      return b;
    } catch (e) {
      if (pathRef.current === p) setBoardError(e as Error);
      return null;
    }
  }, []);
  useEffect(() => {
    setBoard(null);
    void loadBoard();
  }, [path, loadBoard, refreshKey]);

  // ---------------------------------------------------------------- eligibility (batch, cached)
  const eligKey = `${departmentId}|${period.from}|${period.to}|${facilityId}`;
  const keyRef = useRef(eligKey);
  const [cache, setCache] = useState<EligCache>({});
  const loaded = useRef(new Set<string>());
  const inflight = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const workers = useRef(0);
  const order = useRef<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [timing, setTiming] = useState<{ ms: number; evaluations: number } | null>(null);

  const fetchElig = useCallback(
    async (userIds: string[] | undefined, shiftIds?: string[]) => {
      const k = keyRef.current;
      const [dep, from, to, fac] = k.split('|');
      const r = await api<EligResponse>('/api/schedule/planner/eligibility', { method: 'POST', body: { departmentId: dep, from, to, facilityIds: fac ? [fac] : undefined, userIds, shiftIds, days: !shiftIds } });
      if (keyRef.current !== k || !Array.isArray(r?.users)) return false;
      setCache((c) => mergeElig(c, r));
      if (!shiftIds) r.users.forEach((u) => loaded.current.add(u));
      setTiming((x) => ({ ms: (x?.ms ?? 0) + r.ms, evaluations: (x?.evaluations ?? 0) + r.evaluations }));
      return true;
    },
    [],
  );
  const pump = useCallback(() => {
    while (workers.current < 2) {
      const skip = new Set([...loaded.current, ...inflight.current, ...failed.current]);
      const next = chunksToLoad(order.current, skip, CHUNK)[0];
      if (!next) break;
      workers.current++;
      next.forEach((id) => inflight.current.add(id));
      const k = keyRef.current;
      void fetchElig(next)
        .then((ok) => {
          if (!ok) next.forEach((id) => failed.current.add(id));
        })
        .catch(() => next.forEach((id) => failed.current.add(id)))
        .finally(() => {
          workers.current--;
          next.forEach((id) => inflight.current.delete(id));
          if (keyRef.current === k) pump();
          setChecking(workers.current > 0);
        });
    }
    setChecking(workers.current > 0);
  }, [fetchElig]);
  useEffect(() => {
    keyRef.current = eligKey;
    setCache({});
    setTiming(null);
    loaded.current = new Set();
    inflight.current = new Set();
    failed.current = new Set();
  }, [eligKey]);
  useEffect(() => {
    if (board && keyRef.current === eligKey) {
      if (!order.current.length) order.current = board.people.map((p) => p.id);
      pump();
    }
  }, [board, eligKey, pump]);
  const onOrder = useCallback(
    (ids: string[]) => {
      order.current = ids;
      pump();
    },
    [pump],
  );
  const ensure = useCallback(
    (ids: string[]) => {
      const missing = ids.filter((id) => !loaded.current.has(id) && !inflight.current.has(id));
      if (!missing.length) return;
      missing.forEach((id) => inflight.current.add(id));
      void fetchElig(missing).finally(() => missing.forEach((id) => inflight.current.delete(id)));
    },
    [fetchElig],
  );

  /** After a change: fresh board, then fresh checks for the people and shifts it touched. */
  const after = useCallback(
    async (users: Array<string | null | undefined>, shiftIds: string[]) => {
      const before = new Set(boardRef.current?.shifts.map((s) => s.id) ?? []);
      const b = await loadBoard();
      if (!b) return;
      const fresh = b.shifts.filter((s) => !before.has(s.id)).map((s) => s.id);
      const people = [...new Set(users.filter((u): u is string => !!u))];
      people.forEach((u) => loaded.current.delete(u));
      const changed = [...new Set([...shiftIds, ...fresh])].filter((id) => b.shifts.some((s) => s.id === id));
      await Promise.all([people.length ? fetchElig(people).catch(() => false) : null, changed.length ? fetchElig(undefined, changed).catch(() => false) : null]);
    },
    [loadBoard, fetchElig],
  );

  // ---------------------------------------------------------------- announcements
  const [live, setLive] = useState('');
  const say = useCallback((s: string) => setLive((x) => (x === s ? `${s} ` : s)), []);
  const nameOf = useCallback((id: string | null | undefined) => boardRef.current?.people.find((p) => p.id === id)?.name ?? '', []);

  // ---------------------------------------------------------------- overtime confirmation
  const [otAsk, setOtAsk] = useState<{ hours: string; resolve: (ok: boolean) => void } | null>(null);
  const askOvertime = (hours: string) => new Promise<boolean>((resolve) => setOtAsk({ hours, resolve }));
  // ---------------------------------------------------------------- late change to a published shift
  const [lateAsk, setLateAsk] = useState<{ effects: ChangeEffect[]; resolve: (ok: boolean) => void } | null>(null);
  /** Before changing a published shift: when the notice is shorter than the agreement's, say so and ask. */
  async function lateOk(shift: BoardShift, proposal: { startsAt?: string; endsAt?: string; userId?: string | null }) {
    if (shift.status !== 'PUBLISHED') return true;
    try {
      const r = await api<ChangePreview>(`/api/shifts/${shift.id}/change-preview`, { method: 'POST', body: proposal });
      if (!r.late) return true;
      return await new Promise<boolean>((resolve) => setLateAsk({ effects: r.effects.filter((x) => x.late), resolve }));
    } catch {
      return true; // the write itself still checks everything
    }
  }
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const report = useCallback(
    (e: unknown) => {
      const text = reasonsFromError(t, lng, e).join(' · ');
      const refused = e instanceof ApiError && (e.status === 422 || e.status === 403);
      const msg = refused ? `${t('planner.refused')} ${text}` : text;
      toast(msg, 'warn');
      say(msg);
    },
    [t, lng, toast, say],
  );
  /** Runs a write; overtime asks first and retries with the confirmation. */
  async function confirmed<T>(fn: (ack: boolean) => Promise<T>): Promise<{ value: T; ack: boolean } | null> {
    try {
      return { value: await fn(false), ack: false };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERTIME_REQUIRES_ACK') {
        const ok = await askOvertime(String((e.details as { overtimeHours?: string })?.overtimeHours ?? ''));
        if (!ok) return null;
        try {
          return { value: await fn(true), ack: true };
        } catch (e2) {
          report(e2);
          return null;
        }
      }
      report(e);
      return null;
    }
  }

  // ---------------------------------------------------------------- history
  const [history, setHistory] = useState<History>(emptyHistory());
  const historyRef = useRef(history);
  historyRef.current = history;
  const push = (op: Op) => setHistory((h) => record(h, op));
  const done = (msg: string) => {
    toast(msg, 'ok');
    say(msg);
  };

  const versionOf = (id: string) => boardRef.current?.shifts.find((s) => s.id === id)?.version;

  async function assignRaw(shiftId: string, userId: string | null, ack: boolean) {
    const v = versionOf(shiftId);
    if (v === undefined) throw new ApiError(404, 'NOT_IN_VIEW', t('planner.undo.notInView'));
    return api(`/api/shifts/${shiftId}/assign`, { method: 'POST', body: { userId, expectedVersion: v, acknowledgeOvertime: ack } });
  }
  async function moveRaw(shiftId: string, to: Partial<MoveBody> & { copy?: boolean }, ack: boolean) {
    const v = versionOf(shiftId);
    if (v === undefined) throw new ApiError(404, 'NOT_IN_VIEW', t('planner.undo.notInView'));
    return api<{ id: string; created: boolean }>(`/api/schedule/planner/shifts/${shiftId}/move`, { method: 'POST', body: { expectedVersion: v, ...to, acknowledgeOvertime: ack } });
  }
  const createRaw = (body: CreateRequest, ack: boolean) => api<{ ids: string[] }>('/api/schedule/planner/shifts', { method: 'POST', body: { ...body, acknowledgeOvertime: ack } });
  const cancelRaw = (ids: string[]) => api('/api/schedule/planner/cancel', { method: 'POST', body: { shiftIds: ids } });

  const moveBodyOf = (s: BoardShift): MoveBody => ({ startsAt: new Date(s.localStartsAt).toISOString(), endsAt: new Date(s.localEndsAt).toISOString(), positionId: s.positionId, facilityId: s.facilityId, userId: s.userId });

  async function assign(shift: BoardShift, userId: string | null) {
    if (!(await lateOk(shift, { userId }))) return false;
    const r = await confirmed((ack) => assignRaw(shift.id, userId, ack));
    if (!r) return false;
    push({ kind: 'assign', shiftId: shift.id, from: shift.userId, to: userId, label: userId ? t('planner.ops.assign', { name: nameOf(userId) }) : t('planner.ops.unassign', { name: nameOf(shift.userId) }) });
    done(userId ? t('planner.done.assigned', { name: nameOf(userId), when: whenOf(shift) }) : t('planner.done.unassigned', { name: nameOf(shift.userId) }));
    // Young-worker rules couldn't be checked: say so (amber), as the drop target did.
    if (userId && (r.value as { flags?: Array<{ code: string }> } | undefined)?.flags?.some((f) => f.code === 'DATE_OF_BIRTH_MISSING')) toast(t('builder.assignedNoDob'), 'warn');
    await after([shift.userId, userId], [shift.id]);
    return true;
  }

  async function assignMany(shift: BoardShift, ids: string[]) {
    if (ids.length === 1) return assign(shift, ids[0]!);
    const r = await confirmed((ack) => {
      const v = versionOf(shift.id) ?? shift.version;
      return api<{ results: Array<{ userId: string; shiftId: string | null; code: string | null }> }>(`/api/schedule/planner/shifts/${shift.id}/assign-many`, { method: 'POST', body: { expectedVersion: v, userIds: ids, acknowledgeOvertime: ack } });
    });
    if (!r) return false;
    const ok = r.value.results.filter((x) => x.shiftId);
    const no = r.value.results.filter((x) => !x.shiftId);
    const ops: Op[] = ok
      .filter((x) => x.userId !== shift.userId)
      .map((x) =>
        x.shiftId === shift.id
          ? { kind: 'assign' as const, shiftId: shift.id, from: shift.userId, to: x.userId, label: '' }
          : { kind: 'create' as const, ids: [x.shiftId!], body: { ...moveBodyOf(shift), userIds: [x.userId], acknowledgeOvertime: r.ack }, label: '' },
      );
    if (ops.length) push({ kind: 'group', ops, label: t('planner.ops.assignMany', { count: ok.length }) });
    const msg = [t('planner.done.assignedMany', { count: ok.length }), ...no.map((x) => `${nameOf(x.userId)}: ${reasonsText(t, lng, [{ code: x.code ?? 'NOT_FOUND' }])}`)].join(' ');
    if (no.length) toast(msg, 'warn');
    else toast(msg, 'ok');
    say(msg);
    await after([shift.userId, ...ids], [shift.id]);
    return true;
  }

  async function create(body: CreateRequest, ack: boolean) {
    const r = await createRaw(body, ack); // errors go back to the sheet
    push({ kind: 'create', ids: r.ids ?? [], body: { ...body, acknowledgeOvertime: ack }, label: t('planner.ops.create') });
    done(body.userIds.length ? t('planner.done.createdFor', { names: body.userIds.map(nameOf).join(', ') }) : t('builder.added'));
    await after(body.userIds, []);
  }

  async function move(shift: BoardShift, to: Partial<MoveBody>, copy: boolean) {
    if (!copy && !(await lateOk(shift, { startsAt: to.startsAt, endsAt: to.endsAt, ...(to.userId !== undefined ? { userId: to.userId } : {}) }))) return false;
    const r = await confirmed((ack) => moveRaw(shift.id, { ...to, copy }, ack));
    if (!r) return false;
    const target = { ...moveBodyOf(shift), ...to };
    if (r.value.created) {
      push({ kind: 'create', ids: [r.value.id], body: { ...target, userIds: target.userId ? [target.userId] : [], acknowledgeOvertime: r.ack }, label: t('planner.ops.copy') });
      done(t('planner.done.copied'));
    } else {
      push({ kind: 'move', shiftId: shift.id, from: moveBodyOf(shift), to: target, label: t('planner.ops.move') });
      done(t('planner.done.moved', { when: formatTimeRange(isoLocal(target.startsAt, shift), isoLocal(target.endsAt, shift), lng) }));
    }
    await after([shift.userId, to.userId], [shift.id]);
    return true;
  }

  async function copyRange(from: string, to: string, days: 1 | 7) {
    if (!board) return;
    const body = { departmentId, facilityIds: facilityId ? [facilityId] : undefined, from, to, days, withPeople: true };
    try {
      const r = await api<{ created: string[]; assigned: number; leftOpen: Array<{ code: string }>; skippedExisting: number }>('/api/schedule/planner/copy', { method: 'POST', body });
      if (r.created?.length) push({ kind: 'copy', ids: r.created, body, label: t('planner.ops.copyRange') });
      const msg = t('planner.done.copiedRange', { count: r.created?.length ?? 0, assigned: r.assigned ?? 0, open: r.leftOpen?.length ?? 0, skipped: r.skippedExisting ?? 0 });
      toast(msg, r.leftOpen?.length ? 'warn' : 'ok');
      say(msg);
      loaded.current = new Set();
      await loadBoard();
      pump();
    } catch (e) {
      report(e);
    }
  }

  /** Applies one change (or its reverse); returns the ids a redo re-created, if any. */
  async function apply(op: Op, dir: 'undo' | 'redo'): Promise<Array<[string[], string[]]>> {
    if (op.kind === 'group') {
      const out: Array<[string[], string[]]> = [];
      for (const o of dir === 'undo' ? [...op.ops].reverse() : op.ops) out.push(...(await apply(o, dir)));
      return out;
    }
    if (op.kind === 'assign') {
      await assignRaw(op.shiftId, dir === 'undo' ? op.from : op.to, true);
      return [];
    }
    if (op.kind === 'move') {
      await moveRaw(op.shiftId, dir === 'undo' ? op.from : op.to, true);
      return [];
    }
    if (dir === 'undo') {
      await cancelRaw(op.ids);
      return [];
    }
    if (op.kind === 'create') {
      const r = await createRaw(op.body, !!op.body.acknowledgeOvertime);
      return [[op.ids, r.ids]];
    }
    const r = await api<{ created: string[] }>('/api/schedule/planner/copy', { method: 'POST', body: op.body });
    return [[op.ids, r.created ?? []]];
  }
  const touched = (op: Op): { users: Array<string | null>; shifts: string[] } => {
    if (op.kind === 'group') {
      const parts = op.ops.map(touched);
      return { users: parts.flatMap((p) => p.users), shifts: parts.flatMap((p) => p.shifts) };
    }
    if (op.kind === 'assign') return { users: [op.from, op.to], shifts: [op.shiftId] };
    if (op.kind === 'move') return { users: [op.from.userId, op.to.userId], shifts: [op.shiftId] };
    if (op.kind === 'create') return { users: op.body.userIds, shifts: op.ids };
    return { users: [], shifts: op.ids };
  };
  const [stepping, setStepping] = useState(false);
  async function step(dir: 'undo' | 'redo') {
    if (stepping) return;
    const { op, history: next } = dir === 'undo' ? undoStep(historyRef.current) : redoStep(historyRef.current);
    if (!op) return;
    setStepping(true);
    try {
      const created = await apply(op, dir);
      let h = next;
      for (const [from, to] of created) h = remap(h, from, to);
      setHistory(h);
      const msg = t(dir === 'undo' ? 'planner.undone' : 'planner.redone', { what: op.label });
      toast(msg, 'ok');
      say(msg);
      const tt = touched(op);
      if (op.kind === 'copy') {
        loaded.current = new Set();
        await loadBoard();
        pump();
      } else await after(tt.users, tt.shifts);
    } catch (e) {
      report(e);
    } finally {
      setStepping(false);
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void step(e.shiftKey ? 'redo' : 'undo');
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void step('redo');
      } else if (e.key === 'Escape') setPicking(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- selection, picking, sheets
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [details, setDetails] = useState<BoardShift | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [copyMode, setCopyMode] = useState(false);
  const rows = useMemo(() => (board ? rowsOf(board, rowMode) : []), [board, rowMode]);

  const toggleSelect = useCallback((id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const groupFor = (id: string) => (selectedRef.current.has(id) ? [...selectedRef.current] : [id]);
  const onPick = useCallback(
    (id: string) => {
      const ids = groupFor(id);
      ensure(ids);
      setPicking(ids);
      setPeopleOpen(false);
      say(t('planner.sr.picked', { names: ids.map(nameOf).join(', ') }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensure, say, nameOf, t],
  );

  const draftFor = (date: string, rowKey: string | null, userIds: string[], minute?: number): Draft | null => {
    if (!board) return null;
    const row = rows.find((r) => r.key === rowKey);
    const person = board.people.find((p) => p.id === userIds[0]);
    const positionId = row?.positionId ?? (person ? positionFor(person, null) : null) ?? board.positions[0]?.id;
    const fac = row?.facilityId ?? (facilityId || board.facilities[0]?.id);
    if (!positionId || !fac) return null;
    const { start, end } = suggestTimes(board.usual, positionId, person?.availability[date], minute);
    return { date, start, end, positionId, facilityId: fac, userIds };
  };

  const onShiftActivate = useCallback(
    (s: BoardShift) => {
      if (picking) {
        void assignMany(s, picking).then((ok) => ok && setPicking(null));
        return;
      }
      setSheet(s.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picking, board],
  );
  const onDayActivate = useCallback(
    (date: string, rowKey: string | null) => {
      if (!picking) return;
      const d = draftFor(date, rowKey, picking);
      if (d) setDraft(d);
      setPicking(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picking, board, rows, facilityId],
  );
  const onAdd = useCallback(
    (date: string, rowKey: string | null) => {
      const d = draftFor(date, rowKey, []);
      if (d) setDraft(d);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, rows, facilityId],
  );
  const onOpenDay = useCallback((d: string) => {
    setAnchor(d);
    setViewState('day');
    saveView(me?.id, 'day');
  }, [me?.id]);

  // ---------------------------------------------------------------- drag and drop
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [over, setOver] = useState<Target | null>(null);
  const [alt, setAlt] = useState(false);
  const [preview, setPreview] = useState<BarPreview | null>(null);
  const [ghostText, setGhostText] = useState<{ label: string; hint: string; status: string }>({ label: '', hint: '', status: 'unknown' });
  const overRef = useRef('');

  const activeIds = dragging?.kind === 'people' ? dragging.ids : dragging?.kind === 'shift' ? (dragging.shift.userId ? [dragging.shift.userId] : []) : picking;
  const activeKey = activeIds?.join(',') ?? '';
  const shiftStatusFn = useMemo(() => {
    if (!activeIds?.length || dragging?.kind === 'shift') return null;
    return (id: string) => combine(activeIds.map((u) => shiftStatus(cache, u, id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, cache, dragging?.kind]);
  const dayStatusFn = useMemo(() => {
    if (!activeIds?.length) return null;
    return (d: string) => combine(activeIds.map((u) => dayStatus(cache, u, d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, cache]);

  const describe = (target: Target | null, item: DragItem) => {
    const b = boardRef.current;
    if (!b || !target) return { where: '', cell: null as ReturnType<typeof combine> | null };
    const ids = item.kind === 'people' ? item.ids : item.shift.userId ? [item.shift.userId] : [];
    if (target.kind === 'shift') {
      const s = b.shifts.find((x) => x.id === target.id);
      if (!s) return { where: '', cell: null };
      return { where: `${formatDate(s.localStartsAt, lng)} ${whenOf(s)} ${posLabel(lng, s)}`, cell: item.kind === 'people' ? combine(ids.map((u) => shiftStatus(cache, u, s.id))) : null };
    }
    if (target.kind === 'panel') return { where: t('planner.people.title'), cell: null };
    const date = target.date;
    return { where: formatDate(`${date}T12:00:00`, lng, 'long'), cell: ids.length ? combine(ids.map((u) => dayStatus(cache, u, date))) : null };
  };

  const shiftSpan = (item: Extract<DragItem, { kind: 'shift' }>, target: Target | null, p: PointerInfo): [number, number] | null => {
    const s = item.shift;
    const span: [number, number] = [minuteOf(s.localStartsAt), endMinuteOf(s.localStartsAt, s.localEndsAt)];
    if (view !== 'day' || (target && target.kind !== 'time' && target.kind !== 'shift')) return null;
    const delta = (p.dx / pxPerHourFor(window.innerWidth)) * 60;
    return dragSpan(span, delta, item.mode, [0, 24 * 60 + (span[1] > 1440 ? span[1] - 1440 : 0)]);
  };

  const { begin, ghost } = useDrag({
    onStart: (item) => {
      setDragging(item);
      if (item.kind === 'people') ensure(item.ids);
      else if (item.shift.userId) ensure([item.shift.userId]);
      setGhostText({ label: item.label, hint: '', status: 'unknown' });
      say(t(item.kind === 'people' ? 'planner.sr.dragPeople' : 'planner.sr.dragShift', { names: item.label }));
    },
    onOver: (item, target, p) => {
      setAlt(p.alt);
      const k = targetKey(target);
      if (item.kind === 'shift' && view === 'day') {
        const span = shiftSpan(item, target, p);
        const row = target?.kind === 'time' ? target.row : (rows.find((r) => r.positionId === item.shift.positionId || r.facilityId === item.shift.facilityId)?.key ?? '');
        const st = item.shift.userId ? dayStatus(cache, item.shift.userId, anchor).status : 'ok';
        setPreview(span ? { shiftId: item.shift.id, row, start: span[0], end: span[1], status: st } : null);
      }
      if (k === overRef.current) return;
      overRef.current = k;
      setOver(target);
      const d = describe(target, item);
      const hint = d.cell ? (d.cell.status === 'unknown' ? t('planner.status.checking') : d.cell.reasons.length ? `${t(`planner.status.${d.cell.status}`)}: ${reasonsText(t, lng, d.cell.reasons)}` : t(`planner.status.${d.cell.status}`)) : target?.kind === 'panel' ? t('planner.people.dropToUnassign') : '';
      setGhostText({ label: item.label, hint, status: d.cell?.status ?? 'unknown' });
      if (d.where) say(`${d.where}. ${hint}`);
    },
    onDrop: (item, target, p) => {
      const copy = p.alt || copyMode;
      const span = item.kind === 'shift' ? shiftSpan(item, target, p) : null;
      setDragging(null);
      setOver(null);
      setPreview(null);
      overRef.current = '';
      void drop(item, target, copy, span);
    },
    onCancel: () => {
      setDragging(null);
      setOver(null);
      setPreview(null);
      overRef.current = '';
      say(t('planner.sr.cancelled'));
    },
  });

  async function drop(item: DragItem, target: Target | null, copy: boolean, span: [number, number] | null) {
    const b = boardRef.current;
    if (!b || !target) {
      say(t('planner.sr.cancelled'));
      return;
    }
    if (item.kind === 'people') {
      if (target.kind === 'shift') {
        const s = b.shifts.find((x) => x.id === target.id);
        if (s) await assignMany(s, item.ids);
      } else if (target.kind === 'day' || target.kind === 'time') {
        const d = draftFor(target.date, target.row, item.ids, target.kind === 'time' ? target.minute : undefined);
        if (d) setDraft(d);
      }
      return;
    }
    const s = item.shift;
    if (target.kind === 'panel') {
      if (s.userId) await assign(s, null);
      return;
    }
    const tz = s.facility.timezone;
    const toIso = (date: string, min: number) => zonedToInstant(plusDays(date, Math.floor(min / 1440)), hhmm(min), tz).toISOString();
    let date = s.localStartsAt.slice(0, 10);
    let row: string | null = null;
    if (target.kind === 'day' || target.kind === 'time') {
      date = target.date;
      row = target.row;
    } else if (target.kind === 'shift') {
      const other = b.shifts.find((x) => x.id === target.id);
      if (other && other.id !== s.id) date = other.localStartsAt.slice(0, 10);
    }
    const r = rows.find((x) => x.key === row);
    const [st, en] = span ?? [minuteOf(s.localStartsAt), endMinuteOf(s.localStartsAt, s.localEndsAt)];
    const to: Partial<MoveBody> = { startsAt: toIso(date, st), endsAt: toIso(date, en) };
    if (r?.positionId && r.positionId !== s.positionId) to.positionId = r.positionId;
    if (r?.facilityId && r.facilityId !== s.facilityId) to.facilityId = r.facilityId;
    const same = to.startsAt === new Date(s.localStartsAt).toISOString() && to.endsAt === new Date(s.localEndsAt).toISOString() && !to.positionId && !to.facilityId;
    if (same && !copy) {
      say(t('planner.sr.cancelled'));
      return;
    }
    await move(s, to, copy);
  }

  const onPersonDragStart = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (coarsePointer()) return;
      const ids = groupFor(id);
      begin(e, { kind: 'people', ids, label: ids.map(nameOf).join(', ') });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [begin, nameOf],
  );
  const onShiftPointerDown = useCallback(
    (e: React.PointerEvent, s: BoardShift, mode: 'move' | 'start' | 'end') => {
      if (coarsePointer()) return;
      e.stopPropagation();
      begin(e, { kind: 'shift', shift: s, mode, label: `${whenOf(s)} · ${s.assignee?.name ?? t('schedule.open')}` });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [begin, t, lng],
  );
  useEffect(() => {
    if (ghost.current) ghost.current.dataset.alt = String(alt || copyMode);
  }, [alt, copyMode, ghost]);

  // ---------------------------------------------------------------- publish
  const drafts = board?.shifts.filter((s) => s.status === 'DRAFT') ?? [];
  const [publishGroups, setPublishGroups] = useState<PublishGroup[] | null>(null);
  /** Opens the publish check: coverage gaps, people who can no longer work a draft, federal notice. */
  function publish() {
    if (!drafts.length) return;
    const byFacility = new Map<string, BoardShift[]>();
    for (const s of drafts) byFacility.set(s.facilityId, [...(byFacility.get(s.facilityId) ?? []), s]);
    setPublishGroups(
      [...byFacility].map(([fid, list]) => {
        const starts = list.map((s) => new Date(s.localStartsAt).getTime());
        return { facilityId: fid, timezone: list[0]!.facility.timezone, from: new Date(Math.min(...starts)).toISOString(), to: new Date(Math.max(...starts) + 60_000).toISOString(), shiftIds: list.map((s) => s.id) };
      }),
    );
  }
  async function published(r: { published: number; posted: number }) {
    const ids = publishGroups?.flatMap((g) => g.shiftIds) ?? [];
    setPublishGroups(null);
    done(t('builder.published', { count: r.published, open: r.posted }));
    setHistory(emptyHistory());
    try {
      await after([], ids);
    } catch (e) {
      report(e);
    }
  }

  // ---------------------------------------------------------------- render
  const whenOf = (s: Pick<BoardShift, 'localStartsAt' | 'localEndsAt'>) => formatTimeRange(s.localStartsAt, s.localEndsAt, lng);
  const isoLocal = (utcIso: string, s: BoardShift) => {
    const d = new Date(utcIso);
    const tz = s.facility.timezone;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
  };
  const inPeriod = (d: string) => d >= period.from && d < period.to;
  const today = board?.range.today ?? todayIso();
  const focus = view === 'day' ? anchor : inPeriod(focusDay) ? focusDay : inPeriod(today) ? today : period.from;
  const sheetShift = sheet ? board?.shifts.find((s) => s.id === sheet) ?? null : null;
  const title =
    view === 'month'
      ? new Intl.DateTimeFormat(lng, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${anchor.slice(0, 7)}-15T12:00:00Z`))
      : view === 'week'
        ? `${formatDate(`${period.from}T12:00:00`, lng)} – ${formatDate(`${plusDays(period.to, -1)}T12:00:00`, lng)}`
        : formatDate(`${anchor}T12:00:00`, lng, 'long');
  const deptName = (d: { id: string; name: string; nameFr: string | null }) => (d.id === 'none' ? t('fill.noDepartment') : lng === 'fr-CA' && d.nameFr ? d.nameFr : d.name);
  const viewProps = {
    board: board!,
    days: period.days,
    shiftStatus: shiftStatusFn,
    dayStatus: dayStatusFn,
    overKey: targetKey(over),
    onShiftPointerDown,
    onShiftActivate,
    onDayActivate,
    onAdd,
    onOpenDay,
    picking: !!picking,
  };
  const panel = (height: string) =>
    board ? (
      <PeoplePanel
        weekScope={board.hoursScope === 'week'}
        people={board.people}
        positions={board.positions}
        days={period.days.length === 7 ? period.days : [focus]}
        focusDay={focus}
        selected={selected}
        picking={picking}
        shiftDragging={dragging?.kind === 'shift' && !!dragging.shift.userId}
        dropOver={over?.kind === 'panel'}
        onToggle={toggleSelect}
        onPick={onPick}
        onDragStart={onPersonDragStart}
        onOrder={onOrder}
        height={height}
      />
    ) : (
      <Skeleton className="h-96" />
    );

  if (optionsError) return <ErrorNotice onRetry={() => window.location.reload()} />;

  return (
    <div className={cn('grid gap-4', dragging && 'select-none')}>
      <div aria-live="polite" role="status" className="sr-only">
        {live}
      </div>

      {/* Toolbar: department and facility, period, view, rows, copy, undo/redo, publish */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {options && options.departments.length > 1 ? (
            <div className="w-full sm:w-52">
              <Select aria-label={t('fill.department')} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deptName(d)}
                  </option>
                ))}
                {options.canAll ? <option value="all">{t('fill.allDepartments')}</option> : null}
              </Select>
            </div>
          ) : null}
          {options && options.facilities.length > 1 ? (
            <div className="w-full sm:w-52">
              <Select aria-label={t('timeclock.facility')} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                <option value="">{t('planner.allFacilities')}</option>
                {options.facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        <Segmented<View> label={t('planner.views.label')} value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v, label: t(`planner.views.${v}`) }))} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" aria-label={t('planner.prev')} onClick={() => setAnchor(stepAnchor(view, anchor, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <p className="min-w-[10rem] text-center text-body-strong" aria-live="polite">
            {title}
          </p>
          <Button variant="secondary" size="sm" aria-label={t('planner.next')} onClick={() => setAnchor(stepAnchor(view, anchor, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(todayIso(board?.range.timezone))}>
            {t('planner.today')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view !== 'month' && board && board.facilities.length > 1 ? (
            <span className={cn(view === 'week' && 'hidden lg:inline-flex')}>
            <Segmented<RowMode> label={t('planner.rowsBy')} value={rowMode} onChange={setRowMode} options={[{ value: 'position', label: t('planner.byPosition') }, { value: 'facility', label: t('planner.byFacility') }]} />
            </span>
          ) : null}
          {view === 'week' ? (
            <Button variant="secondary" size="sm" icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} onClick={() => void copyRange(plusDays(period.from, -7), period.from, 7)}>
              {t('planner.copyLastWeek')}
            </Button>
          ) : view === 'day' ? (
            <Button variant="secondary" size="sm" icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} onClick={() => void copyRange(plusDays(anchor, -1), anchor, 1)}>
              {t('planner.copyYesterday')}
            </Button>
          ) : null}
          <button
            type="button"
            aria-pressed={copyMode}
            onClick={() => setCopyMode((c) => !c)}
            title={t('planner.copyHint')}
            className={cn('hidden h-9 items-center gap-1.5 rounded-xl border px-3 text-small font-semibold md:inline-flex', copyMode ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted hover:text-ink')}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {t('planner.copyToggle')}
          </button>
          <Button variant="ghost" size="sm" aria-label={t('planner.undo.button')} title={history.past.at(-1)?.label} disabled={!history.past.length || stepping} onClick={() => void step('undo')}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" aria-label={t('planner.redo')} title={history.future[0]?.label} disabled={!history.future.length || stepping} onClick={() => void step('redo')}>
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="secondary" size="sm" className="xl:hidden" icon={<Users className="h-4 w-4" aria-hidden="true" />} onClick={() => setPeopleOpen(true)}>
            {t('planner.people.open', { count: board?.people.length ?? 0 })}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2">
        <p className="text-small text-muted">
          {t('planner.unpublished', { count: drafts.length })}
          {history.past.length ? ` · ${t('planner.changes', { count: history.past.length })}` : ''}
          {checking ? ` · ${t('planner.status.checking')}` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon={<CalendarCog className="h-4 w-4" aria-hidden="true" />} onClick={() => setTemplatesOpen(true)}>
            {t('planner.templates')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenFill}>
            {t('fill.open')}
          </Button>
          <Button size="sm" icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={!!publishGroups} disabled={!drafts.length} onClick={publish}>
            {t('builder.publish', { count: drafts.length })}
          </Button>
        </div>
      </div>

      {picking ? (
        <div role="status" className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand bg-panel px-3 py-2 shadow-lift">
          <p className="text-small">
            <span className="font-semibold">{t('planner.pick.title', { names: picking.map(nameOf).join(', ') })}</span> {t('planner.pick.help')}
          </p>
          <Button variant="secondary" size="sm" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => setPicking(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[15.5rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <div className="sticky top-4">{panel('calc(100dvh - 17rem)')}</div>
        </aside>
        <div className="min-w-0">
          {boardError ? (
            <ErrorNotice onRetry={() => void loadBoard()} />
          ) : !board ? (
            <Skeleton className="h-96" />
          ) : view === 'month' ? (
            <MonthView {...viewProps} month={anchor.slice(0, 7)} focusDay={focus} onFocusDay={setFocusDay} />
          ) : view === 'week' ? (
            <WeekView {...viewProps} rows={rows} />
          ) : (
            <DayView {...viewProps} rows={rows} day={anchor} preview={preview} facilityId={facilityId || null} />
          )}
          {board && !board.shifts.length ? <p className="mt-3 text-small text-muted">{t('planner.empty')}</p> : null}
          <p className="mt-3 hidden text-caption text-muted xl:block">{t('planner.hint')}</p>
          {timing ? <p className="sr-only">{t('planner.checked', { count: timing.evaluations })}</p> : null}
        </div>
      </div>

      {/* The drag ghost: moved through a ref, never re-rendered per pointer move. */}
      <div ref={ghost} aria-hidden="true" className={cn('pointer-events-none fixed left-0 top-0 z-[60] max-w-[16rem] rounded-xl border border-line bg-panel px-3 py-2 shadow-lift', !dragging && 'hidden')}>
        <p className="truncate text-small font-semibold">{ghostText.label}</p>
        {ghostText.hint ? <p className={cn('text-caption', ghostText.status === 'ok' ? 'text-ok' : ghostText.status === 'warn' ? 'text-warn' : ghostText.status === 'block' ? 'text-danger' : 'text-muted')}>{ghostText.hint}</p> : null}
        {dragging?.kind === 'shift' && (alt || copyMode) ? <p className="text-caption font-semibold text-brand-text">{t('planner.copying')}</p> : null}
      </div>

      <Dialog open={peopleOpen} onClose={() => setPeopleOpen(false)} title={t('planner.people.title')} description={t('planner.people.phoneHelp')} closeLabel={t('common.close')}>
        {peopleOpen ? panel('55dvh') : null}
      </Dialog>

      {sheetShift && board ? (
        <AssignSheet
          shift={sheetShift}
          people={board.people}
          cache={cache}
          loading={checking}
          onClose={() => setSheet(null)}
          onAssign={async (userId) => {
            if (await assign(sheetShift, userId)) setSheet(null);
          }}
          onUnassign={async () => {
            if (await assign(sheetShift, null)) setSheet(null);
          }}
          onTimes={async (start, end) => {
            const tz = sheetShift.facility.timezone;
            const date = sheetShift.localStartsAt.slice(0, 10);
            const s = zonedToInstant(date, start, tz);
            let e = zonedToInstant(date, end, tz);
            if (e <= s) e = zonedToInstant(plusDays(date, 1), end, tz);
            if (await move(sheetShift, { startsAt: s.toISOString(), endsAt: e.toISOString() }, false)) setSheet(null);
          }}
          onDetails={() => {
            setDetails(sheetShift);
            setSheet(null);
          }}
        />
      ) : null}
      {details ? (
        <ShiftDialog
          shift={details}
          onClose={() => setDetails(null)}
          onChanged={(c) => {
            if (c) push({ kind: 'assign', shiftId: details.id, from: c.from, to: c.to, label: c.to ? t('planner.ops.assign', { name: nameOf(c.to) }) : t('planner.ops.unassign', { name: nameOf(c.from) }) });
            void after([c?.from, c?.to, details.userId], [details.id]);
          }}
        />
      ) : null}
      {board ? <QuickCreate draft={draft} board={board} onClose={() => setDraft(null)} onCreate={create} /> : null}
      <PublishDialog open={!!publishGroups} groups={publishGroups ?? []} onClose={() => setPublishGroups(null)} onPublished={(r) => void published(r)} />

      <Dialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} title={t('rotations.generateTitle')} description={t('planner.templatesHelp')} closeLabel={t('common.close')}>
        {templatesOpen ? (
          <div className="grid gap-3">
            <GeneratePanel
              departmentId={departmentId}
              from={period.from}
              to={period.to}
              onDone={() => {
                loaded.current = new Set();
                void loadBoard().then(() => pump());
              }}
            />
            <a href="/manage/rotations" className="inline-flex min-h-11 items-center text-small font-semibold text-brand-text hover:underline">{t('planner.manageTemplates')}</a>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={!!lateAsk}
        onClose={() => {
          lateAsk?.resolve(false);
          setLateAsk(null);
        }}
        title={t('planner.late.title')}
        closeLabel={t('common.close')}
      >
        <div className="grid gap-2 rounded-xl bg-warn-bg p-4 text-small">
          {lateAsk?.effects.map((e, i) => (
            <p key={i}>
              {t(`planner.late.${e.kind}`, { name: nameOf(e.userId) || t('planner.late.someone'), hours: e.noticeHours, required: e.requiredHours ?? 0 })}{' '}
              {e.premiumHours ? t('planner.late.premiumHours', { hours: e.premiumHours, m: e.multiplier }) : e.flatAmount ? t('planner.late.flat', { amount: e.flatAmount }) : t('planner.late.noPremium')}
            </p>
          ))}
          <p className="text-caption text-muted">{t('planner.late.notify')}</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              lateAsk?.resolve(false);
              setLateAsk(null);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              lateAsk?.resolve(true);
              setLateAsk(null);
            }}
          >
            {t('planner.late.confirm')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!otAsk}
        onClose={() => {
          otAsk?.resolve(false);
          setOtAsk(null);
        }}
        title={t('planner.overtimeTitle')}
        closeLabel={t('common.close')}
      >
        <p className="text-small">{t('builder.overtimeAsk', { hours: otAsk?.hours ?? '' })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              otAsk?.resolve(false);
              setOtAsk(null);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              otAsk?.resolve(true);
              setOtAsk(null);
            }}
          >
            {t('builder.assignWithOvertime')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}



