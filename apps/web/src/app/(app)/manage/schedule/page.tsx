'use client';

import { CalendarRange, ChevronLeft, ChevronRight, Plus, Send, Sparkles, UserCheck, UserMinus, XCircle } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatHours, formatTimeRange } from '@/lib/format';
import { mondayOf, zonedToInstant } from '@/lib/tz';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';

interface Facility { id: string; name: string; timezone: string }
interface Position { id: string; name: string; nameFr: string | null }
interface Shift {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
  localStartsAt: string;
  localEndsAt: string;
  hours: number;
  positionId: string;
  position: Position;
  facility: { name: string };
  customTitle: string | null;
  conflictReason: string | null;
  assignee: { id: string; name: string } | null;
}
interface Candidate { user: { id: string; firstName: string; lastName: string; employmentStatus: string }; eligible: boolean; overtimeHours: string; weeklyHoursAfter: string; blocks: Array<{ code: string }> }
interface Proposal { assignments: Array<{ shiftId: string; userId: string }>; unfilled: Array<{ shiftId: string; reason: string }> }

export default function ScheduleBuilderPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const facilities = useQuery<Facility[]>('/api/facilities');
  const positions = useQuery<Position[]>('/api/positions');
  const staff = useQuery<Array<{ id: string; name: string }>>('/api/users');
  const [facilityId, setFacilityId] = useState('');
  const facility = facilities.data?.find((f) => f.id === facilityId) ?? facilities.data?.[0];
  const [week, setWeek] = useState(() => mondayOf(todayIso()));
  const range = useMemo(() => {
    if (!facility) return null;
    return { from: zonedToInstant(week, '00:00', facility.timezone).toISOString(), to: zonedToInstant(plusDays(week, 7), '00:00', facility.timezone).toISOString() };
  }, [facility, week]);
  const shifts = useQuery<Shift[]>(facility && range ? `/api/shifts?facilityId=${facility.id}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null);
  const { run, busy } = useAction();
  const [adding, setAdding] = useState<string | null>(null);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [assistant, setAssistant] = useState<Proposal | null>(null);
  const [mode, setMode] = useState<'SENIORITY' | 'EGALITARIAN'>('SENIORITY');

  useEffect(() => {
    if (!facilityId && facilities.data?.[0]) setFacilityId(facilities.data[0].id);
  }, [facilities.data, facilityId]);

  const days = Array.from({ length: 7 }, (_, i) => plusDays(week, i));
  const posName = (p: Position) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);
  const drafts = shifts.data?.filter((s) => s.status === 'DRAFT').length ?? 0;
  const open = shifts.data?.filter((s) => !s.assignee).length ?? 0;
  const nameOf = (id: string) => staff.data?.find((u) => u.id === id)?.name ?? '—';

  async function addShift(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!facility || !adding) return;
    const f = new FormData(e.currentTarget);
    const date = String(f.get('date'));
    const start = zonedToInstant(date, String(f.get('start')), facility.timezone);
    let end = zonedToInstant(date, String(f.get('end')), facility.timezone);
    if (end <= start) end = zonedToInstant(plusDays(date, 1), String(f.get('end')), facility.timezone); // overnight
    const r = await run('add', () =>
      api('/api/shifts', {
        method: 'POST',
        body: { facilityId: facility.id, positionId: f.get('position'), startsAt: start.toISOString(), endsAt: end.toISOString(), shiftType: f.get('type'), customTitle: String(f.get('title') || '') || null },
      }),
      t('builder.added'),
    );
    if (r) {
      setAdding(null);
      await shifts.reload();
    }
  }

  async function runAssistant(apply: boolean) {
    if (!facility || !range) return;
    const r = await run(apply ? 'apply' : 'preview', () =>
      api<Proposal>('/api/schedule/assist', { method: 'POST', body: { facilityId: facility.id, from: range.from, to: range.to, distributionMode: mode, useShadowTiers: true, apply } }),
    );
    if (!r) return;
    if (apply) {
      toast(t('builder.applied', { count: r.assignments.length }), 'ok');
      setAssistant(null);
      await shifts.reload();
    } else setAssistant(r);
  }

  async function publish() {
    if (!facility || !range) return;
    const r = await run('publish', () => api<{ published: number; postedToBoard: number }>('/api/shifts/publish', { method: 'POST', body: { facilityId: facility.id, from: range.from, to: range.to } }));
    if (r) {
      toast(t('builder.published', { count: r.published, open: r.postedToBoard }), 'ok');
      await shifts.reload();
    }
  }

  return (
    <>
      <PageHeader
        title={t('builder.title')}
        description={t('builder.description')}
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="h-5 w-5" aria-hidden="true" />} loading={busy === 'preview'} onClick={() => void runAssistant(false)} disabled={!open}>
              {t('builder.assist')}
            </Button>
            <Button icon={<Send className="h-5 w-5" aria-hidden="true" />} loading={busy === 'publish'} onClick={() => void publish()} disabled={!drafts}>
              {t('builder.publish', { count: drafts })}
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label={t('builder.prevWeek')} onClick={() => setWeek(plusDays(week, -7))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <p className="min-w-[12rem] text-center text-body-strong">
            {formatDate(`${week}T12:00:00`, lng)} – {formatDate(`${plusDays(week, 6)}T12:00:00`, lng)}
          </p>
          <Button variant="secondary" size="sm" aria-label={t('builder.nextWeek')} onClick={() => setWeek(plusDays(week, 7))}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeek(mondayOf(todayIso()))}>
            {t('builder.thisWeek')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {open ? <StatusPill tone="new">{t('builder.openCount', { count: open })}</StatusPill> : null}
          {facilities.data && facilities.data.length > 1 ? (
            <div className="w-64">
              <Select aria-label={t('timeclock.facility')} value={facility?.id ?? ''} onChange={(e) => setFacilityId(e.target.value)}>
                {facilities.data.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      </div>

      {shifts.loading || !facility ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((d) => {
            const list = (shifts.data ?? []).filter((s) => s.localStartsAt.startsWith(d));
            const isToday = d === todayIso(facility.timezone);
            return (
              <section key={d} aria-label={formatDate(`${d}T12:00:00`, lng, 'long')} className={cn('flex min-h-[8rem] flex-col rounded-xl2 border bg-panel p-2', isToday ? 'border-brand/50' : 'border-line')}>
                <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
                  <p className={cn('text-small font-bold', isToday && 'text-brand-text')}>{formatDate(`${d}T12:00:00`, lng)}</p>
                  <button type="button" onClick={() => setAdding(d)} aria-label={t('builder.addOn', { day: formatDate(`${d}T12:00:00`, lng) })} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </header>
                <div className="grid gap-1.5">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelected(s)}
                      className={cn(
                        'rounded-xl border px-2.5 py-2 text-left transition-colors hover:border-brand/50',
                        s.status === 'DRAFT' ? 'border-dashed border-muted/50 bg-surface/50' : 'border-line bg-panel',
                        !s.assignee && 'border-new/40 bg-new-bg/40',
                      )}
                    >
                      <p className="text-caption font-semibold tabular-nums">{formatTimeRange(s.localStartsAt, s.localEndsAt, lng)}</p>
                      <p className="truncate text-caption text-muted">{s.customTitle || posName(s.position)}</p>
                      <p className={cn('mt-1 truncate text-caption font-semibold', s.assignee ? 'text-ink' : 'text-new')}>{s.assignee?.name ?? t('schedule.open')}</p>
                      {s.conflictReason && !s.assignee ? <p className="mt-1 line-clamp-2 text-[0.75rem] leading-4 text-warn">{s.conflictReason}</p> : null}
                    </button>
                  ))}
                  {!list.length ? <p className="px-1.5 py-2 text-caption text-muted/80">{t('builder.noShifts')}</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {shifts.data && !shifts.data.length ? (
        <div className="mt-6">
          <EmptyState icon={CalendarRange} title={t('builder.emptyTitle')}>
            {t('builder.emptyBody')}
          </EmptyState>
        </div>
      ) : null}

      <Dialog open={adding !== null} onClose={() => setAdding(null)} title={t('builder.addShift')} description={facility ? t('builder.inZone', { zone: facility.timezone }) : undefined} closeLabel={t('common.close')}>
        {adding ? (
          <form onSubmit={(e) => void addShift(e)} className="grid gap-4">
            <Field label={t('timeOff.date')}>{(p) => <Input {...p} type="date" name="date" defaultValue={adding} required />}</Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('timeOff.startTime')}>{(p) => <Input {...p} type="time" name="start" defaultValue="06:00" required />}</Field>
              <Field label={t('timeOff.endTime')}>{(p) => <Input {...p} type="time" name="end" defaultValue="10:00" required />}</Field>
            </div>
            <Field label={t('builder.position')}>
              {(p) => (
                <Select {...p} name="position" required>
                  {positions.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {posName(x)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('builder.type')}>
                {(p) => (
                  <Select {...p} name="type" defaultValue="STANDARD">
                    {(['STANDARD', 'CUSTOM', 'MANDATORY'] as const).map((x) => (
                      <option key={x} value={x}>
                        {t(`builder.types.${x}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('builder.customTitle')} hint={t('builder.customHint')}>
                {(p) => <Input {...p} name="title" maxLength={120} />}
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy === 'add'}>
                {t('builder.addAsDraft')}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {selected ? <ShiftDialog shift={selected} onClose={() => setSelected(null)} onChanged={() => void shifts.reload()} /> : null}

      <Dialog
        open={assistant !== null}
        onClose={() => setAssistant(null)}
        title={t('builder.assistTitle')}
        description={t('builder.assistHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssistant(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy === 'apply'} disabled={!assistant?.assignments.length} onClick={() => void runAssistant(true)}>
              {t('builder.applyDrafts', { count: assistant?.assignments.length ?? 0 })}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label={t('builder.distribution')}>
            {(p) => (
              <Select
                {...p}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setAssistant(null);
                }}
              >
                <option value="SENIORITY">{t('builder.seniority')}</option>
                <option value="EGALITARIAN">{t('builder.egalitarian')}</option>
              </Select>
            )}
          </Field>
          <ul className="grid max-h-80 gap-2 overflow-y-auto">
            {assistant?.assignments.map((a) => {
              const s = shifts.data?.find((x) => x.id === a.shiftId);
              return s ? (
                <li key={a.shiftId} className="flex items-center justify-between gap-3 rounded-xl bg-ok-bg/60 px-3 py-2 text-small">
                  <span className="tabular-nums">
                    {formatDate(s.localStartsAt, lng)} · {formatTimeRange(s.localStartsAt, s.localEndsAt, lng)}
                  </span>
                  <span className="font-semibold">{nameOf(a.userId)}</span>
                </li>
              ) : null;
            })}
            {assistant?.unfilled.map((u) => {
              const s = shifts.data?.find((x) => x.id === u.shiftId);
              return s ? (
                <li key={u.shiftId} className="rounded-xl bg-warn-bg px-3 py-2 text-small">
                  <p className="tabular-nums">
                    {formatDate(s.localStartsAt, lng)} · {formatTimeRange(s.localStartsAt, s.localEndsAt, lng)} · <span className="font-semibold text-warn">{t('builder.unfilled')}</span>
                  </p>
                  <p className="text-caption text-muted">{u.reason}</p>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      </Dialog>
    </>
  );
}

function ShiftDialog({ shift, onClose, onChanged }: { shift: Shift; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const candidates = useQuery<{ shiftVersion: number; candidates: Candidate[] }>(`/api/shifts/${shift.id}/candidates`);
  const [busy, setBusy] = useState<string | null>(null);
  const [ackFor, setAckFor] = useState<{ userId: string; hours: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function assign(userId: string | null, acknowledgeOvertime = false) {
    setBusy(userId ?? 'none');
    try {
      await api(`/api/shifts/${shift.id}/assign`, { method: 'POST', body: { userId, expectedVersion: candidates.data?.shiftVersion ?? shift.version, acknowledgeOvertime } });
      toast(userId ? t('builder.assigned') : t('builder.unassigned'), 'ok');
      onChanged();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERTIME_REQUIRES_ACK' && userId) setAckFor({ userId, hours: (e.details as { overtimeHours: string }).overtimeHours });
      else toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function cancel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('cancel');
    try {
      await api(`/api/shifts/${shift.id}/cancel`, { method: 'POST', body: { reason: String(new FormData(e.currentTarget).get('reason')) } });
      toast(t('builder.cancelled'), 'ok');
      onChanged();
      onClose();
    } catch {
      toast(t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  const posName = lng === 'fr-CA' && shift.position.nameFr ? shift.position.nameFr : shift.position.name;

  return (
    <Dialog open onClose={onClose} title={shift.customTitle || posName} description={`${formatDate(shift.localStartsAt, lng, 'long')} · ${formatTimeRange(shift.localStartsAt, shift.localEndsAt, lng)} · ${formatHours(shift.hours, lng)}`} closeLabel={t('common.close')}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={shift.status === 'DRAFT' ? 'neutral' : 'brand'}>{t(`builder.status.${shift.status}`)}</StatusPill>
          {shift.assignee ? <StatusPill tone="ok">{shift.assignee.name}</StatusPill> : <StatusPill tone="new">{t('schedule.open')}</StatusPill>}
        </div>

        {ackFor ? (
          <div className="rounded-xl bg-warn-bg p-4">
            <p className="text-small text-ink">{t('builder.overtimeAsk', { hours: ackFor.hours })}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAckFor(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" loading={busy === ackFor.userId} onClick={() => void assign(ackFor.userId, true)}>
                {t('builder.assignWithOvertime')}
              </Button>
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-label uppercase text-muted">{t('builder.candidates')}</h3>
          {candidates.loading ? (
            <Skeleton className="h-40" />
          ) : (
            <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
              {candidates.data?.candidates.map((c) => {
                const ot = Number(c.overtimeHours) > 0;
                return (
                  <li key={c.user.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-small font-semibold">
                        {c.user.firstName} {c.user.lastName}
                      </p>
                      <p className="truncate text-caption text-muted">
                        {c.eligible ? t('builder.weekHours', { hours: formatHours(c.weeklyHoursAfter, lng) }) : c.blocks.map((b) => t(`blocks.${b.code}`)).join(' ')}
                      </p>
                    </div>
                    {c.eligible ? (
                      <Button size="sm" variant={ot ? 'secondary' : 'primary'} icon={<UserCheck className="h-4 w-4" aria-hidden="true" />} loading={busy === c.user.id} onClick={() => void assign(c.user.id)}>
                        {ot ? t('builder.assignOt', { hours: c.overtimeHours }) : t('builder.assign')}
                      </Button>
                    ) : (
                      <StatusPill tone="warn">{t('builder.blocked')}</StatusPill>
                    )}
                  </li>
                );
              })}
              {!candidates.data?.candidates.length ? <p className="text-small text-muted">{t('builder.noCandidates')}</p> : null}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          {shift.assignee ? (
            <Button variant="secondary" size="sm" icon={<UserMinus className="h-4 w-4" aria-hidden="true" />} loading={busy === 'none'} onClick={() => void assign(null)}>
              {t('builder.unassign')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="sm" icon={<XCircle className="h-4 w-4" aria-hidden="true" />} onClick={() => setCancelling((c) => !c)}>
            {t('builder.cancelShift')}
          </Button>
        </div>
        {cancelling ? (
          <form onSubmit={(e) => void cancel(e)} className="grid gap-3">
            <Field label={t('builder.cancelReason')} hint={t('builder.cancelHint')}>
              {(p) => <Textarea {...p} name="reason" required minLength={3} maxLength={200} />}
            </Field>
            <Button type="submit" variant="danger" loading={busy === 'cancel'}>
              {t('builder.confirmCancel')}
            </Button>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}
