'use client';

/**
 * "Fill the schedule": a three-step sheet. 1) Department and dates, 2) anything to keep in
 * mind (sensible defaults, priorities behind "Adjust priorities"), 3) review: a plain summary,
 * then the proposals laid out like the schedule, week by week and day by day. Tap a proposal to
 * see why and swap for one of the next three; open shifts come with next steps. Accept all, a
 * week or a day (as drafts), undo, then publish through the usual step.
 */
import { CalendarCheck, ChevronDown, Info, Send, Undo2, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  type FillOptions,
  type FillWeek,
  type Horizon,
  HORIZONS,
  type Item,
  type NewShift,
  type ReviewState,
  type Toggles,
  type UndoEntry,
  WEIGHT_KEYS,
  type Weights,
  type Why,
  acceptBody,
  acceptItem,
  beyondWindow,
  emptyReview,
  grouped,
  itemsOf,
  peopleOf,
  popUndo,
  pushUndo,
  slotIdOf,
  summarize,
  weeksOf,
} from '@/lib/fill';
import { type PublishGroup, PublishDialog } from '@/components/PublishDialog';
import { formatDate, formatHours, formatMoney, formatTimeRange } from '@/lib/format';
import { useSession } from '@/lib/session';
import { plusDays, useQuery } from '@/lib/useQuery';
import { zonedToInstant } from '@/lib/tz';

type Step = 'setup' | 'priorities' | 'running' | 'review';

export function FillSchedule({ open, onClose, weekStart, onChanged }: { open: boolean; onClose: () => void; weekStart: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const { can } = useSession();
  const options = useQuery<FillOptions>(open ? '/api/schedule/fill/options' : null);
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>(open ? '/api/positions' : null);
  const [step, setStep] = useState<Step>('setup');
  const [departmentId, setDepartmentId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [horizon, setHorizon] = useState<Horizon>(2);
  const [horizonTouched, setHorizonTouched] = useState(false);
  const [forecastPosition, setForecastPosition] = useState('');
  // Rotation templates: generate their drafts for the horizon first, then fill the gaps.
  const [fromTemplates, setFromTemplates] = useState(false);
  const [toggles, setToggles] = useState<Toggles | null>(null);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [progress, setProgress] = useState({ done: 0, of: 1 });
  const [weeks, setWeeks] = useState<FillWeek[]>([]);
  const [review, setReview] = useState<ReviewState>(emptyReview());
  const [openItem, setOpenItem] = useState<string | null>(null);
  // One entry per accept, latest last: undo takes back one accept at a time.
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  // Forecast shifts created on accept: slot id ("new:…") → the real shift.
  const [created, setCreated] = useState<Record<string, string>>({});
  const [publishGroups, setPublishGroups] = useState<{ groups: PublishGroup[]; slotIds: string[]; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const o = options.data;
  const department = o?.departments.find((d) => d.id === departmentId);
  const planAhead: Horizon = departmentId === 'all' ? (Math.min(...(o?.departments.map((d) => d.planAheadWeeks) ?? [2])) as Horizon) : (department?.planAheadWeeks ?? o?.settings.planAheadWeeks ?? 2);
  const useSeniority = departmentId === 'all' ? !!o?.departments.every((d) => d.useSeniority) : !!department?.useSeniority;
  const deptName = (d: { name: string; nameFr: string | null; id: string }) => (d.id === 'none' ? t('fill.noDepartment') : lng === 'fr-CA' && d.nameFr ? d.nameFr : d.name);
  const posName = (p: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);
  const deptPositions = (positions.data ?? []).filter((p) => (departmentId === 'all' ? o?.departments.flatMap((d) => d.positionIds) : department?.positionIds)?.includes(p.id));
  const status = useQuery<{ through: string; people: Array<{ id: string; current: boolean }> }>(open && departmentId ? `/api/availability/status?departmentId=${departmentId}` : null);

  // Start on the person's own department, this week, and the plan-ahead window.
  useEffect(() => {
    if (!o || departmentId) return;
    setDepartmentId(o.defaultDepartmentId ?? o.departments[0]?.id ?? '');
    setToggles(o.settings.toggles);
    setWeights(o.settings.weights);
  }, [o, departmentId]);
  useEffect(() => {
    if (!horizonTouched) setHorizon(planAhead);
  }, [planAhead, horizonTouched]);
  useEffect(() => {
    if (!open) {
      setStep('setup');
      setWeeks([]);
      setReview(emptyReview());
      setUndoStack([]);
      setCreated({});
      setError(null);
      cancelled.current = true;
    } else cancelled.current = false;
  }, [open]);

  const items = useMemo(() => itemsOf(weeks), [weeks]);
  const people = useMemo(() => peopleOf(weeks), [weeks]);
  const sum = summarize(weeks, items, review);
  const nameOf = (id: string) => people[id]?.name ?? '—';
  const whyText = (w: Why) => t(`fill.why.${w.code}`, { ...w.params, hours: w.params?.hours !== undefined ? formatHours(w.params.hours as number, lng) : undefined, defaultValue: '' });
  const reasonsText = (ws: Why[]) => ws.map(whyText).filter(Boolean).join(' · ');

  async function runAll() {
    if (!o) return;
    setStep('running');
    setError(null);
    const starts = weeksOf(weekStart, horizon);
    setProgress({ done: 0, of: starts.length });
    const out: FillWeek[] = [];
    let carry: Array<{ shiftId: string; userId: string }> = [];
    const facilityIds = facilityId ? [facilityId] : undefined;
    try {
      if (fromTemplates) {
        const end = new Date(`${weekStart}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + horizon * 7);
        const g = await api<{ created: number; assigned: number; open: number }>('/api/schedule/rotations/generate', { method: 'POST', body: { departmentId, from: weekStart, to: end.toISOString().slice(0, 10) } });
        toast(t('fill.templatesGenerated', { created: g.created, assigned: g.assigned, open: g.open }), 'ok');
      }
      for (let i = 0; i < starts.length; i++) {
        if (cancelled.current) return;
        // The forecast's suggested shifts are a preview: proposed with the rest, created only on accept.
        const newShifts: NewShift[] = [];
        if (forecastPosition) {
          for (const f of facilityId ? o.facilities.filter((x) => x.id === facilityId) : o.facilities) {
            const r = await api<{ shifts: Array<{ facilityId: string; positionId: string; startsAt: string; endsAt: string }> }>('/api/forecast/preview-shifts', { method: 'POST', body: { facilityId: f.id, weekStart: starts[i], positionId: forecastPosition } }).catch(() => ({ shifts: [] }));
            r.shifts.forEach((x, k) => newShifts.push({ ...x, key: `${i}-${f.id.slice(0, 8)}-${k}` }));
          }
        }
        const w = await api<FillWeek>('/api/schedule/fill/run', {
          method: 'POST',
          body: { departmentId, facilityIds, weekStart: starts[i], horizonStart: weekStart, weekIndex: i, horizonWeeks: horizon, carry, toggles, weights, newShifts },
        });
        out.push(w);
        carry = [...carry, ...w.carry];
        setProgress({ done: i + 1, of: starts.length });
      }
      setWeeks(out);
      setReview(emptyReview());
      setStep('review');
    } catch (e) {
      setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'));
      setStep('priorities');
    }
  }

  type AcceptResult = { applied: number; skipped: Array<{ shiftId: string; code: string }>; undoIds: string[]; created: Array<{ key: string; shiftId: string }> };
  /** Sends accept requests; marks what went through, remembers created shifts, and pushes one undo entry. */
  async function send(body: ReturnType<typeof acceptBody>, allowOvertime: boolean, mark: 'accepted' | 'handled') {
    const r = await api<AcceptResult>('/api/schedule/fill/accept', { method: 'POST', body: { items: body, allowOvertime } });
    const skipped = new Set(r.skipped.map((x) => x.shiftId));
    const ok = body.map(slotIdOf).filter((id) => !skipped.has(id));
    const made = Object.fromEntries(r.created.map((c) => [c.key, c.shiftId]));
    setCreated((x) => ({ ...x, ...made }));
    // A forecast shift nobody could take was still created, open: it needs the scheduler.
    setReview((x) => ({ ...x, [mark]: { ...x[mark], ...Object.fromEntries(ok.map((id) => [id, true as const])) } }));
    setUndoStack((st) => pushUndo(st, { undoIds: r.undoIds, slotIds: [...new Set([...ok, ...Object.keys(made)])] }));
    return r;
  }

  async function accept(filter: (i: Item) => boolean, key: string) {
    const body = acceptBody(items.filter(filter), review);
    if (!body.length) return;
    setBusy(key);
    try {
      const r = await send(body, !toggles?.avoidOvertime, 'accepted');
      toast(r.skipped.length ? t('fill.acceptedSome', { count: r.applied, skipped: r.skipped.length }) : t('fill.accepted', { count: r.applied }), r.skipped.length ? 'warn' : 'ok');
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  /** Takes back the latest accept only (earlier ones stay). */
  async function undo() {
    const { stack, entry, review: next } = popUndo(undoStack, review);
    if (!entry) return;
    setBusy('undo');
    try {
      const r = await api<{ restored: number; leftOpen: number }>('/api/schedule/fill/undo', { method: 'POST', body: { undoIds: entry.undoIds } });
      setUndoStack(stack);
      setReview(next);
      setCreated((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !entry.slotIds.includes(k))));
      toast(r.leftOpen ? t('fill.undoneLeftOpen', { count: r.restored, open: r.leftOpen }) : t('fill.undone', { count: r.restored }), r.leftOpen ? 'warn' : 'ok');
      onChanged();
    } catch {
      toast(t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  /** Publishes what was accepted (and only that), facility by facility, after the publish check. */
  function publish(ids: string[], key = 'publish') {
    if (!o || !ids.length) return;
    const byFacility = new Map<string, string[]>();
    for (const it of items.filter((i) => ids.includes(i.slot.id))) {
      const real = it.slot.newShift ? created[it.slot.id] : it.slot.id;
      if (real) byFacility.set(it.slot.facilityId, [...(byFacility.get(it.slot.facilityId) ?? []), real]);
    }
    if (!byFacility.size) return;
    setPublishGroups({
      key,
      slotIds: ids,
      groups: [...byFacility].map(([fid, shiftIds]) => {
        const tz = o.facilities.find((f) => f.id === fid)?.timezone ?? 'America/Toronto';
        return { facilityId: fid, timezone: tz, shiftIds, from: zonedToInstant(weekStart, '00:00', tz).toISOString(), to: zonedToInstant(plusDays(weekStart, horizon * 7), '00:00', tz).toISOString() };
      }),
    });
  }
  function published(r: { published: number; posted: number }) {
    const done = publishGroups;
    setPublishGroups(null);
    setUndoStack([]);
    if (done?.key.startsWith('post-')) setReview((x) => ({ ...x, handled: { ...x.handled, ...Object.fromEntries(done.slotIds.map((id) => [id, true as const])) } }));
    toast(t('builder.published', { count: r.published, open: r.posted }), 'ok');
    onChanged();
  }

  /** An open shift onto the Shift Board: a forecast one is created (open) first. */
  async function post(it: Item) {
    if (it.slot.newShift && !created[it.slot.id]) {
      setBusy(`post-${it.slot.id}`);
      try {
        const r = await send([acceptItem(it.slot, null)], false, 'handled');
        const id = r.created[0]?.shiftId;
        if (!id) return;
        setReview((x) => {
          const handled = { ...x.handled };
          delete handled[it.slot.id];
          return { ...x, handled };
        });
        const tz = o?.facilities.find((f) => f.id === it.slot.facilityId)?.timezone ?? 'America/Toronto';
        setPublishGroups({ key: `post-${it.slot.id}`, slotIds: [it.slot.id], groups: [{ facilityId: it.slot.facilityId, timezone: tz, shiftIds: [id], from: zonedToInstant(weekStart, '00:00', tz).toISOString(), to: zonedToInstant(plusDays(weekStart, horizon * 7), '00:00', tz).toISOString() }] });
      } catch (e) {
        toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
      } finally {
        setBusy(null);
      }
      return;
    }
    publish([it.slot.id], `post-${it.slot.id}`);
  }

  /** A forecast shift nobody could take: create it as an open draft to deal with later. */
  async function createOpen(it: Item) {
    setBusy(`open-${it.slot.id}`);
    try {
      await send([acceptItem(it.slot, null)], false, 'handled');
      toast(t('fill.createdOpen'), 'ok');
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function askWithOvertime(it: Item, userId: string) {
    setBusy(`ask-${it.slot.id}`);
    try {
      if (it.slot.newShift) {
        const r = await send([acceptItem(it.slot, userId)], true, 'handled');
        if (r.skipped.length) throw new ApiError(422, r.skipped[0]!.code, t(`fill.block.${r.skipped[0]!.code}`, { count: 1, defaultValue: t('common.error') }));
      } else {
        await api(`/api/shifts/${it.slot.id}/assign`, { method: 'POST', body: { userId, expectedVersion: it.slot.version, acknowledgeOvertime: true } });
        setReview((x) => ({ ...x, handled: { ...x.handled, [it.slot.id]: true } }));
      }
      toast(t('builder.assigned'), 'ok');
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function remind() {
    setBusy('remind');
    try {
      const r = await api<{ sent: number }>('/api/availability/remind', { method: 'POST', body: { departmentId } });
      toast(t('fill.reminded', { count: r.sent }), 'ok');
    } finally {
      setBusy(null);
    }
  }

  async function saveDefaults() {
    if (!weights || !toggles || departmentId === 'all') return;
    setBusy('save');
    try {
      await api('/api/schedule/fill/settings', { method: 'PUT', body: { departmentId: departmentId === 'none' ? null : departmentId, weights, toggles } });
      toast(t('fill.savedDefaults'), 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  const horizonLabel = (h: Horizon) => t(`fill.horizon.${h}`);
  const acceptedIds = Object.keys(review.accepted);
  const pendingCount = acceptBody(items, review).length;
  const notCurrent = status.data?.people.filter((p) => !p.current).length ?? 0;

  const title = step === 'review' ? t('fill.reviewTitle') : t('fill.title');
  const stepNo = step === 'setup' ? 1 : step === 'priorities' ? 2 : 3;

  const footer =
    step === 'setup' ? (
      <>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={() => setStep('priorities')} disabled={!departmentId}>{t('fill.next')}</Button>
      </>
    ) : step === 'priorities' ? (
      <>
        <Button variant="ghost" onClick={() => setStep('setup')}>{t('fill.back')}</Button>
        <Button icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />} onClick={() => void runAll()}>{t('fill.run')}</Button>
      </>
    ) : (
      <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
    );

  return (
    <Dialog open={open} onClose={onClose} title={title} description={step === 'running' ? undefined : t('fill.step', { n: stepNo })} closeLabel={t('common.close')} footer={footer}>
      {!o ? (
        <Skeleton className="h-48" />
      ) : !o.departments.length ? (
        <EmptyState icon={Info} title={t('fill.noDepartmentsTitle')}>{t('fill.noDepartmentsBody')}</EmptyState>
      ) : step === 'setup' ? (
        <div className="grid gap-4">
          <Field label={t('fill.department')}>
            {(p) => (
              <Select {...p} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                {o.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deptName(d)}
                    {d.own ? ` · ${t('fill.yours')}` : ''}
                  </option>
                ))}
                {o.canAll ? <option value="all">{t('fill.allDepartments')}</option> : null}
              </Select>
            )}
          </Field>
          {o.facilities.length > 1 ? (
            <Field label={t('fill.facilities')}>
              {(p) => (
                <Select {...p} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                  <option value="">{t('fill.allFacilities')}</option>
                  {o.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
          <div className="grid gap-1.5">
            <p className="text-small font-semibold" id="fill-horizon">{t('fill.howFar')}</p>
            <Segmented
              label={t('fill.howFar')}
              value={String(horizon) as `${Horizon}`}
              onChange={(v) => {
                setHorizon(Number(v) as Horizon);
                setHorizonTouched(true);
              }}
              options={HORIZONS.map((h) => ({ value: String(h) as `${Horizon}`, label: horizonLabel(h) }))}
            />
            <p className="text-caption text-muted">
              {t('fill.from', { date: formatDate(`${weekStart}T12:00:00`, lng, 'long') })} · {t('fill.planAhead', { window: horizonLabel(planAhead) })}
            </p>
            {beyondWindow(horizon, planAhead) ? (
              <p className="flex items-start gap-2 rounded-xl bg-surface px-3 py-2 text-small text-ink">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                {t('fill.beyondWindow', { window: horizonLabel(planAhead) })}
              </p>
            ) : null}
          </div>
          {status.data && status.data.people.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <p className="text-small">
                {notCurrent
                  ? t('fill.availabilityMissing', { count: notCurrent, of: status.data.people.length, date: formatDate(`${status.data.through}T12:00:00`, lng) })
                  : t('fill.availabilityAll', { date: formatDate(`${status.data.through}T12:00:00`, lng) })}
              </p>
              {notCurrent ? <Button size="sm" variant="secondary" loading={busy === 'remind'} onClick={() => void remind()}>{t('fill.remind')}</Button> : null}
            </div>
          ) : null}
          <label className="flex min-h-11 items-start gap-3 text-small">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={fromTemplates} onChange={(e) => setFromTemplates(e.target.checked)} />
            <span>
              <span className="block font-semibold">{t('fill.fromTemplates')}</span>
              <span className="text-caption text-muted">{t('fill.fromTemplatesHelp')}</span>
            </span>
          </label>
          {deptPositions.length ? (
            <Field label={t('fill.forecast')} hint={t('fill.forecastHint')}>
              {(p) => (
                <Select {...p} value={forecastPosition} onChange={(e) => setForecastPosition(e.target.value)}>
                  <option value="">{t('fill.forecastNone')}</option>
                  {deptPositions.map((x) => <option key={x.id} value={x.id}>{posName(x)}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
      ) : step === 'priorities' && toggles && weights ? (
        <div className="grid gap-3">
          <p className="text-small text-muted">{t('fill.keepInMind')}</p>
          {(['keepAssigned', 'avoidOvertime', 'spreadWeekends', 'sameFacility'] as const).map((k) => (
            <label key={k} className="flex min-h-11 items-start gap-3 text-small">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={toggles[k]} onChange={(e) => setToggles({ ...toggles, [k]: e.target.checked })} />
              <span>
                <span className="block font-semibold">{t(`fill.toggle.${k}`)}</span>
                <span className="text-caption text-muted">{t(`fill.toggleHelp.${k}`)}</span>
              </span>
            </label>
          ))}
          <button type="button" aria-expanded={adjust} onClick={() => setAdjust((x) => !x)} className="flex min-h-11 items-center gap-2 justify-self-start rounded-lg px-1 text-small font-semibold text-brand-text hover:underline">
            <ChevronDown className={cn('h-4 w-4 transition-transform', adjust && 'rotate-180')} aria-hidden="true" />
            {t('fill.adjust')}
          </button>
          {adjust ? (
            <div className="grid gap-3 rounded-xl border border-line p-3">
              <PrioritySliders weights={weights} onChange={setWeights} showSeniority={useSeniority} />
              {can('schedule.assist') && departmentId !== 'all' ? (
                <Button size="sm" variant="secondary" className="justify-self-start" loading={busy === 'save'} onClick={() => void saveDefaults()}>{t('fill.saveDefaults')}</Button>
              ) : null}
            </div>
          ) : null}
          {error ? <p role="alert" className="rounded-xl bg-warn-bg px-3 py-2 text-small text-warn">{error}</p> : null}
        </div>
      ) : step === 'running' ? (
        <div className="grid gap-4 py-6 text-center" role="status" aria-live="polite">
          <CalendarCheck className="mx-auto h-8 w-8 text-brand-text" aria-hidden="true" />
          <p className="text-body-strong">{t('fill.running')}</p>
          <p className="text-small text-muted">{t('fill.progress', { done: Math.min(progress.done + 1, progress.of), of: progress.of })}</p>
          <div className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${Math.max(8, (progress.done / progress.of) * 100)}%` }} />
          </div>
        </div>
      ) : step === 'review' ? (
        !items.length ? (
          <EmptyState icon={CalendarCheck} title={t('fill.nothingTitle')}>{t('fill.nothingBody')}</EmptyState>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="text-body-strong">
                {[
                  t('fill.summaryFilled', { filled: sum.filled, total: sum.total }),
                  sum.overtimeHours > 0 ? t('fill.summaryOvertime', { hours: formatHours(sum.overtimeHours, lng), cost: formatMoney(sum.overtimeCost, lng) }) : t('fill.summaryNoOvertime'),
                  sum.needYou ? t('fill.summaryNeedYou', { count: sum.needYou }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {sum.tentative ? <p className="mt-1 text-caption text-muted">{t('fill.summaryTentative', { count: sum.tentative })}</p> : null}
              {weeks.flatMap((w) => w.coverageGaps).length ? (
                <p className="mt-1 text-caption text-warn">{t('fill.coverageGaps', { names: [...new Set(weeks.flatMap((w) => w.coverageGaps.map((g) => g.name)))].join(', ') })}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingCount ? (
                  <Button size="sm" icon={<CalendarCheck className="h-4 w-4" aria-hidden="true" />} loading={busy === 'all'} onClick={() => void accept(() => true, 'all')}>
                    {t('fill.acceptAll', { count: pendingCount })}
                  </Button>
                ) : null}
                {acceptedIds.length ? (
                  <Button size="sm" variant={pendingCount ? 'secondary' : 'primary'} icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={publishGroups?.key === 'publish'} onClick={() => publish(acceptedIds)}>
                    {t('fill.publish', { count: acceptedIds.length })}
                  </Button>
                ) : null}
                {undoStack.length ? (
                  <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'undo'} onClick={() => void undo()}>
                    {t('fill.undo')}
                  </Button>
                ) : null}
              </div>
            </div>
            {grouped(items).map((w) => (
              <section key={w.week} aria-label={t('fill.weekOf', { date: formatDate(`${w.week}T12:00:00`, lng) })} className="grid gap-3">
                {weeks.length > 1 ? (
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1">
                    <h3 className="text-small font-bold">
                      {t('fill.weekOf', { date: formatDate(`${w.week}T12:00:00`, lng) })}
                      {weeks.find((x) => x.week.start === w.week)?.week.tentative ? <StatusPill tone="neutral" className="ml-2">{t('fill.tentative')}</StatusPill> : null}
                    </h3>
                    <Button size="sm" variant="ghost" loading={busy === `w-${w.week}`} disabled={!acceptBody(w.days.flatMap((d) => d.items), review).length} onClick={() => void accept((i) => i.week === w.week, `w-${w.week}`)}>
                      {t('fill.acceptWeek')}
                    </Button>
                  </header>
                ) : null}
                {w.days.map((d) => (
                  <div key={d.day} className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-caption font-bold uppercase text-muted">{formatDate(`${d.day}T12:00:00`, lng, 'long')}</h4>
                      <Button size="sm" variant="ghost" loading={busy === `d-${d.day}`} disabled={!acceptBody(d.items, review).length} onClick={() => void accept((i) => i.day === d.day, `d-${d.day}`)}>
                        {t('fill.acceptDay')}
                      </Button>
                    </div>
                    <ul className="grid gap-1.5">
                      {d.items.map((it) => (
                        <ReviewItem
                          key={it.slot.id}
                          it={it}
                          review={review}
                          open={openItem === it.slot.id}
                          onToggle={() => setOpenItem((x) => (x === it.slot.id ? null : it.slot.id))}
                          nameOf={nameOf}
                          fromOf={(id) => (people[id]?.fromDepartment ? deptName({ ...people[id]!.fromDepartment!, id: '' }) : null)}
                          reasonsText={reasonsText}
                          posName={posName}
                          busy={busy}
                          onSwap={(userId) => setReview((x) => ({ ...x, choice: { ...x.choice, [it.slot.id]: userId } }))}
                          onDecline={(on) => setReview((x) => {
                            const declined = { ...x.declined };
                            if (on) declined[it.slot.id] = true;
                            else delete declined[it.slot.id];
                            return { ...x, declined };
                          })}
                          onPost={() => void post(it)}
                          onCreateOpen={() => void createOpen(it)}
                          onAsk={(userId) => void askWithOvertime(it, userId)}
                          onLeave={() => setReview((x) => ({ ...x, handled: { ...x.handled, [it.slot.id]: true } }))}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )
      ) : null}
      <PublishDialog open={!!publishGroups} groups={publishGroups?.groups ?? []} onClose={() => setPublishGroups(null)} onPublished={published} />
    </Dialog>
  );
}

function ReviewItem({
  it,
  review,
  open,
  onToggle,
  nameOf,
  fromOf,
  reasonsText,
  posName,
  busy,
  onSwap,
  onDecline,
  onPost,
  onCreateOpen,
  onAsk,
  onLeave,
}: {
  it: Item;
  review: ReviewState;
  open: boolean;
  onToggle: () => void;
  nameOf: (id: string) => string;
  fromOf: (id: string) => string | null;
  reasonsText: (w: Why[]) => string;
  posName: (p: { name: string; nameFr: string | null }) => string;
  busy: string | null;
  onSwap: (userId: string) => void;
  onDecline: (on: boolean) => void;
  onPost: () => void;
  onCreateOpen: () => void;
  onAsk: (userId: string) => void;
  onLeave: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const s = it.slot;
  const when = formatTimeRange(s.localStartsAt, s.localEndsAt, lng);
  const what = `${s.customTitle || posName(s.position)} · ${s.facilityName}`;
  const id = `fill-item-${s.id}`;

  if (it.proposal) {
    const p = it.proposal;
    const chosen = review.choice[s.id] ?? p.userId;
    const alt = p.alternatives.find((a) => a.userId === chosen);
    const reasons = alt ? alt.reasons : p.reasons;
    const declined = !!review.declined[s.id];
    const accepted = !!review.accepted[s.id];
    const from = fromOf(chosen);
    return (
      <li className={cn('rounded-xl border', declined ? 'border-line bg-panel opacity-70' : accepted ? 'border-ok/40 bg-ok-bg/60' : 'border-brand/30 bg-brand/5')}>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left">
          <span className="min-w-0">
            <span className="block text-caption tabular-nums text-muted">{when} · {what}</span>
            <span className={cn('block truncate text-small font-semibold', declined && 'line-through')}>
              {nameOf(chosen)}
              {from ? <span className="ml-1 font-normal text-muted">· {t('fill.fromDepartment', { name: from })}</span> : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {accepted ? <StatusPill tone="ok">{t('fill.acceptedPill')}</StatusPill> : null}
            {s.newShift ? <StatusPill tone="new">{t('fill.newPill')}</StatusPill> : null}
            {s.statHoliday ? <StatusPill tone="neutral">{t('fill.holidayPill')}</StatusPill> : null}
            {p.tentative ? <StatusPill tone="neutral">{t('fill.tentative')}</StatusPill> : null}
            {(alt?.overtimeHours ?? p.overtimeHours) > 0 ? <StatusPill tone="warn">{t('fill.overtimePill')}</StatusPill> : null}
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </span>
        </button>
        {open ? (
          <div id={id} className="grid gap-3 border-t border-line/60 px-3 py-3">
            <p className="text-small">
              <span className="font-semibold">{nameOf(chosen)}:</span> {t('fill.qualifiedAs', { position: posName(s.position) })} {reasonsText(reasons)}
            </p>
            {!accepted && p.alternatives.length ? (
              <div className="grid gap-1.5">
                <p className="text-caption font-bold uppercase text-muted">{t('fill.alternatives')}</p>
                {[{ userId: p.userId, reasons: p.reasons }, ...p.alternatives].filter((a) => a.userId !== chosen).slice(0, 3).map((a) => (
                  <div key={a.userId} className="flex items-center justify-between gap-3 rounded-lg bg-panel px-2.5 py-1.5">
                    <span className="min-w-0 text-small">
                      <span className="block font-semibold">{nameOf(a.userId)}{fromOf(a.userId) ? <span className="font-normal text-muted"> · {t('fill.fromDepartment', { name: fromOf(a.userId) })}</span> : null}</span>
                      <span className="block text-caption text-muted">{reasonsText(a.reasons)}</span>
                    </span>
                    <Button size="sm" variant="secondary" icon={<UserCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => onSwap(a.userId)} aria-label={t('fill.swapTo', { name: nameOf(a.userId) })}>
                      {t('fill.swap')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {!accepted ? (
              <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => onDecline(!declined)}>
                {declined ? t('fill.useAgain') : t('fill.decline')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  const u = it.unfilled!;
  const handled = !!review.handled[s.id];
  const blocked = u.counts.map((c) => t(`fill.block.${c.code}`, { count: c.count, defaultValue: t('fill.block.OTHER', { count: c.count }) })).join(', ');
  return (
    <li className={cn('rounded-xl border px-3 py-2', handled ? 'border-line bg-panel opacity-70' : 'border-warn/40 bg-warn-bg/50')}>
      <p className="flex flex-wrap items-center gap-1.5 text-caption tabular-nums text-muted">
        {when} · {what}
        {s.newShift ? <StatusPill tone="new">{t('fill.newPill')}</StatusPill> : null}
      </p>
      <p className="text-small font-semibold text-warn">{handled ? t('fill.handled') : t('fill.needsYou')}</p>
      <p className="text-caption text-muted">{u.qualified ? t('fill.whyOpen', { count: u.qualified, reasons: blocked }) : t('fill.noneQualified')}</p>
      {!handled ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === `post-${s.id}`} onClick={onPost}>{t('fill.postToBoard')}</Button>
          {u.overtimeOption ? (
            <Button size="sm" variant="secondary" loading={busy === `ask-${s.id}`} onClick={() => onAsk(u.overtimeOption!.userId)}>
              {t('fill.askWithOvertime', { name: nameOf(u.overtimeOption.userId), hours: formatHours(u.overtimeOption.overtimeHours, lng) })}
            </Button>
          ) : null}
          {s.newShift ? (
            <Button size="sm" variant="secondary" loading={busy === `open-${s.id}`} onClick={onCreateOpen}>{t('fill.createOpen')}</Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onLeave}>{s.newShift ? t('fill.dontCreate') : t('fill.leaveOpen')}</Button>
        </div>
      ) : null}
    </li>
  );
}

/** Plain-language sliders for what matters most (0 = doesn't matter, 10 = matters most). */
export function PrioritySliders({ weights, onChange, showSeniority }: { weights: Weights; onChange: (w: Weights) => void; showSeniority: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      {WEIGHT_KEYS.filter((k) => k !== 'seniority' || showSeniority).map((k) => (
        <label key={k} className="grid gap-1 text-small">
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold">{t(`fill.weight.${k}`)}</span>
            <span className="text-caption text-muted">{t(weights[k] >= 7 ? 'fill.level.high' : weights[k] >= 3 ? 'fill.level.some' : weights[k] > 0 ? 'fill.level.low' : 'fill.level.off')}</span>
          </span>
          <input type="range" min={0} max={10} step={1} value={weights[k]} onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) })} className="h-11 w-full accent-[rgb(var(--brand))]" aria-valuetext={t(weights[k] >= 7 ? 'fill.level.high' : weights[k] >= 3 ? 'fill.level.some' : weights[k] > 0 ? 'fill.level.low' : 'fill.level.off')} />
          <span className="text-caption text-muted">{t(`fill.weightHelp.${k}`)}</span>
        </label>
      ))}
    </div>
  );
}
