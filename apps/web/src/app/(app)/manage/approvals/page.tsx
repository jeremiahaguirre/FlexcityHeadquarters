'use client';

import { OvertimeOrder } from '@/components/OvertimeOrder';
import { Check, ClipboardCheck, Clock3, Pencil, Plus, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShiftCard, type ShiftLike } from '@/components/ShiftCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { TradeApprovals } from '@/components/shiftboard/Trades';
import { TeamScopeSwitch, useTeamScope } from '@/components/people/Reporting';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { type ApprovalTab, approvalTabs } from '@/lib/approvals';
import { formatDate, formatDuration, formatHours, formatSpan, formatTime, formatTimeRange } from '@/lib/format';
import { LONG_PUNCH_HOURS } from '@/lib/punch';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface Claim { id: string; claimant: { id: string; name: string } | null; complianceSnapshot: { overtimeHours?: string } | null; shift: ShiftLike & { id: string } }
interface TimeOff { id: string; type: string; startsAt: string; endsAt: string; note: string | null; user: { name: string }; affectedShifts: number }
interface Punch {
  id: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  user: { id?: string; name: string };
  facility: { id?: string; name: string };
  localClockIn: string;
  localClockOut: string | null;
  localShiftStart: string | null;
  localShiftEnd: string | null;
  hours: number | null;
  attention: string[];
  /** Saved on the person's phone without a connection; when each part reached the server. */
  recordedOffline?: boolean;
  localClockInReceivedAt?: string | null;
  localClockOutReceivedAt?: string | null;
  clockSkewS?: number | null;
  /** This supervisor added or changed the time, so someone else approves it. */
  correctedByYou?: boolean;
}
type Tab = ApprovalTab;
const PROTECTED = new Set(['SICK', 'PROTECTED_LEAVE']);

/** Everything waiting for a supervisor in one place: shift claims, time off, punches and trades, each tab shown only with the permission to decide it. */
export default function ApprovalsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  // "My team" (the people who report to me) is the default for managers; "Everyone I can approve" is the full queue, as before.
  const scope = useTeamScope();
  const { team, ready } = scope;
  const tq = scope.query ? `?${scope.query}` : '';
  const claims = useQuery<Claim[]>(ready && can('shiftboard.approve') ? `/api/offers/pending${tq}` : null);
  const timeOff = useQuery<TimeOff[]>(ready && can('timeoff.approve') ? `/api/time-off${tq}` : null);
  const punches = useQuery<Punch[]>(ready && can('timeclock.review') ? `/api/punches${tq}` : null);
  const [picked, setTab] = useState<Tab>('claims');
  // Punches: the queue waiting for review, or ones already approved (to correct a time; it then goes back for review).
  const [punchView, setPunchView] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const approvedPunches = useQuery<Punch[]>(ready && can('timeclock.review') && punchView !== 'PENDING' ? `/api/punches?status=${punchView}${scope.query ? `&${scope.query}` : ''}` : null);
  const [editing, setEditing] = useState<Punch | null>(null);
  const [adding, setAdding] = useState(false);
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<{ kind: 'punch' | 'timeoff'; ids: string[]; protectedLeave?: boolean } | null>(null);

  const trades = useQuery<unknown[]>(ready && can('shiftboard.approve') ? `/api/trades${tq}` : null);
  const count = { claims: claims.data?.length ?? 0, trades: trades.data?.length ?? 0, timeoff: timeOff.data?.length ?? 0, punches: punches.data?.length ?? 0 };
  const decideClaim = (id: string, decision: 'APPROVE' | 'DENY') =>
    run(`${decision}-${id}`, () => api(`/api/offers/${id}/decision`, { method: 'POST', body: { decision } }), t(`approvals.claim.${decision}`)).then(() => claims.reload());
  const decideTimeOff = (id: string, decision: 'APPROVE' | 'DENY', note?: string) =>
    run(`${decision}-${id}`, () => api<{ reopenedShifts: number }>(`/api/time-off/${id}/decision`, { method: 'POST', body: { decision, note } }), t(`approvals.timeOffDone.${decision}`)).then((r) => {
      if (r) void timeOff.reload();
      return r;
    });
  const decidePunches = (ids: string[], decision: 'APPROVE' | 'REJECT', note?: string) =>
    run(`punch-${decision}`, () => api('/api/punches/decision', { method: 'POST', body: { ids, decision, note } }), t(`approvals.punch.${decision}`, { count: ids.length })).then(() => {
      setSelected(new Set());
      return punches.reload();
    });

  // Open on the first tab that has something waiting, once every list has loaded, unless the person already chose one.
  const chosen = useRef(false);
  const order = approvalTabs(can);
  const tab: Tab = order.includes(picked) ? picked : (order[0] ?? picked);
  const allLoaded = ready && !claims.loading && !timeOff.loading && !punches.loading && !trades.loading;
  const firstWithItems = allLoaded ? order.find((k) => count[k] > 0) : undefined;
  useEffect(() => {
    if (!chosen.current && firstWithItems) {
      chosen.current = true;
      setTab(firstWithItems);
    }
  }, [firstWithItems]);
  const choose = (k: Tab) => {
    chosen.current = true;
    setTab(k);
  };

  // A tab that had items and is now empty after the supervisor's own decisions gets a short celebration.
  const seen = useRef<Partial<Record<Tab, number>>>({});
  const [cleared, setCleared] = useState<Tab | null>(null);
  useEffect(() => {
    if (!allLoaded) return;
    for (const k of order) {
      if ((seen.current[k] ?? 0) > 0 && count[k] === 0) setCleared(k);
      seen.current[k] = count[k];
    }
  });

  const label = (k: Tab) => `${t(`approvals.tabs.${k}`)}${count[k] ? ` · ${count[k]}` : ''}`;
  const reviewable = punches.data?.filter((p) => p.localClockOut && !p.correctedByYou) ?? [];

  return (
    <>
      <PageHeader
        title={t('approvals.title')}
        description={t('approvals.description')}
        actions={
          <Segmented
            label={t('approvals.title')}
            value={tab}
            onChange={choose}
            options={order.map((k) => ({ value: k, label: label(k) }))}
          />
        }
      />
      {scope.hasTeam ? (
        <div className="mb-4">
          <TeamScopeSwitch scope={scope} />
        </div>
      ) : null}

      {tab === 'claims' ? (
        claims.loading ? (
          <ListSkeleton />
        ) : !claims.data?.length ? (
          <EmptyState icon={ClipboardCheck} title={t('approvals.allClear')} celebrate={cleared === tab}>
            {t('approvals.claimsEmpty')}
          </EmptyState>
        ) : (
          <div className="fh-stagger grid gap-3">
            {claims.data.map((c) => (
              <ShiftCard
                key={c.id}
                shift={c.shift}
                aside={<StatusPill tone="warn">{t('approvals.overtime', { hours: c.complianceSnapshot?.overtimeHours ?? '?' })}</StatusPill>}
                footer={
                  <>
                    <div className="mr-auto text-small">
                      <p>
                        <span className="font-semibold">{c.claimant?.name}</span> {t('approvals.wantsShift')}
                      </p>
                      {c.claimant ? <ClaimFairness shiftId={c.shift.id} userId={c.claimant.id} /> : null}
                    </div>
                    <Button variant="secondary" size="sm" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={busy === `DENY-${c.id}`} onClick={() => void decideClaim(c.id, 'DENY')}>
                      {t('approvals.decline')}
                    </Button>
                    <Button size="sm" icon={<Check className="h-4 w-4" aria-hidden="true" />} loading={busy === `APPROVE-${c.id}`} onClick={() => void decideClaim(c.id, 'APPROVE')}>
                      {t('approvals.approveOvertime')}
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        )
      ) : null}

      {tab === 'timeoff' ? (
        timeOff.loading ? (
          <ListSkeleton />
        ) : !timeOff.data?.length ? (
          <EmptyState icon={ClipboardCheck} title={t('approvals.allClear')} celebrate={cleared === tab}>
            {t('approvals.timeOffEmpty')}
          </EmptyState>
        ) : (
          <div className="grid gap-3">
            {timeOff.data.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-subheading">{r.user.name}</p>
                    <p className="text-small text-muted">
                      {t(`timeOff.types.${r.type}`)} · {formatDate(r.startsAt, lng)} – {formatDate(new Date(new Date(r.endsAt).getTime() - 1).toISOString(), lng)}
                    </p>
                    {r.note ? <p className="mt-1 text-small">“{r.note}”</p> : null}
                  </div>
                  {r.affectedShifts ? <StatusPill tone="warn">{t('approvals.affects', { count: r.affectedShifts })}</StatusPill> : <StatusPill tone="ok">{t('approvals.noShifts')}</StatusPill>}
                </div>
                {PROTECTED.has(r.type) ? <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-caption text-muted">{t('approvals.protectedNote')}</p> : null}
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setRejecting({ kind: 'timeoff', ids: [r.id], protectedLeave: PROTECTED.has(r.type) })}>
                    {t('approvals.decline')}
                  </Button>
                  <Button size="sm" loading={busy === `APPROVE-${r.id}`} onClick={() => void decideTimeOff(r.id, 'APPROVE').then((x) => x && undefined)}>
                    {r.affectedShifts ? t('approvals.approveAndPost') : t('approvals.approve')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'trades' ? <TradeApprovals key={tq} team={team} /> : null}

      {tab === 'punches' ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label={t('approvals.punchView')}
            value={punchView}
            onChange={setPunchView}
            options={[
              { value: 'PENDING', label: t('approvals.punchViews.PENDING') },
              { value: 'APPROVED', label: t('approvals.punchViews.APPROVED') },
              { value: 'REJECTED', label: t('approvals.punchViews.REJECTED') },
            ]}
          />
          {can('users.read') ? (
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>
              {t('approvals.addPunch')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {tab === 'punches' && punchView !== 'PENDING' ? (
        approvedPunches.loading || !approvedPunches.data ? (
          <ListSkeleton />
        ) : !approvedPunches.data.length ? (
          <EmptyState icon={ClipboardCheck} title={t(punchView === 'APPROVED' ? 'approvals.noApprovedPunches' : 'approvals.noRejectedPunches')}>
            {t('approvals.noApprovedPunchesHelp')}
          </EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {approvedPunches.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-small font-semibold">
                      {p.user.name} · <span className="font-normal text-muted">{formatDate(p.localClockIn, lng)}</span>
                    </p>
                    <p className="text-caption tabular-nums text-muted">
                      {t('approvals.punched')}: {p.localClockOut ? formatSpan(p.localClockIn, p.localClockOut, lng, { startDate: false }) : `${formatTime(p.localClockIn, lng)} – …`}
                    </p>
                  </div>
                  {p.hours != null ? <span className="whitespace-nowrap text-small font-semibold tabular-nums">{formatDuration(p.hours, lng)}</span> : null}
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} aria-label={t('approvals.editTimesFor', { name: p.user.name })} onClick={() => setEditing(p)}>
                    {t('approvals.editTimes')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      {tab === 'punches' && punchView === 'PENDING' ? (
        punches.loading ? (
          <ListSkeleton />
        ) : !punches.data?.length ? (
          <EmptyState icon={ClipboardCheck} title={t('approvals.allClear')} celebrate={cleared === tab}>
            {t('approvals.punchesEmpty')}
          </EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <label className="flex items-center gap-2 text-small font-semibold">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[rgb(var(--brand))]"
                  checked={selected.size > 0 && selected.size === reviewable.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(reviewable.map((p) => p.id)) : new Set())}
                />
                {t('approvals.selectAll', { count: reviewable.length })}
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={!selected.size} onClick={() => setRejecting({ kind: 'punch', ids: [...selected] })}>
                  {t('approvals.reject')}
                </Button>
                <Button size="sm" disabled={!selected.size} loading={busy === 'punch-APPROVE'} onClick={() => void decidePunches([...selected], 'APPROVE')}>
                  {selected.size ? t('approvals.approveSelected', { count: selected.size }) : t('approvals.approveNone')}
                </Button>
              </div>
            </div>
            <ul className="fh-stagger divide-y divide-line">
              {punches.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={t('approvals.selectPunch', { name: p.user.name })}
                    disabled={!p.localClockOut || p.correctedByYou}
                    className="h-5 w-5 accent-[rgb(var(--brand))]"
                    checked={selected.has(p.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setSelected(next);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-small font-semibold">
                      {p.user.name} · <span className="font-normal text-muted">{formatDate(p.localClockIn, lng)}</span>
                    </p>
                    <p className="text-caption tabular-nums text-muted">
                      {t('approvals.punched')}: {p.localClockOut ? formatSpan(p.localClockIn, p.localClockOut, lng, { startDate: false }) : `${formatTime(p.localClockIn, lng)} – …`}
                      {p.localShiftStart && p.localShiftEnd ? ` · ${t('approvals.scheduled')}: ${formatTimeRange(p.localShiftStart, p.localShiftEnd, lng)}` : ''}
                    </p>
                    {p.recordedOffline ? <OfflineNote p={p} lng={lng} /> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.attention.map((a) => (
                      <StatusPill key={a} tone="warn">
                        {t(`approvals.attention.${a}`)}
                      </StatusPill>
                    ))}
                    {p.hours != null && p.hours > LONG_PUNCH_HOURS ? <StatusPill tone="warn">{t('timeclock.longPunch')}</StatusPill> : null}
                    {p.hours != null ? <span className="ml-1 whitespace-nowrap text-small font-semibold tabular-nums" title={formatHours(p.hours, lng, 'payroll')}>{formatDuration(p.hours, lng)}</span> : null}
                    {p.correctedByYou ? <StatusPill tone="neutral">{t('approvals.correctedByYou')}</StatusPill> : null}
                    {!p.localClockOut ? (
                      <StatusPill tone="warn" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}>
                        {t('approvals.stillOpen')}
                      </StatusPill>
                    ) : null}
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} aria-label={t('approvals.editTimesFor', { name: p.user.name })} onClick={() => setEditing(p)}>
                      {p.localClockOut ? t('approvals.editTimes') : t('approvals.addClockOut')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      {editing ? (
        <EditPunchDialog
          punch={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([punches.reload(), punchView !== 'PENDING' ? approvedPunches.reload() : Promise.resolve()]);
          }}
        />
      ) : null}
      {adding ? (
        <AddPunchDialog
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await punches.reload();
          }}
        />
      ) : null}

      <Dialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting?.kind === 'punch' ? t('approvals.rejectPunches', { count: rejecting.ids.length }) : t('approvals.declineTimeOff')}
        description={rejecting?.protectedLeave ? t('approvals.protectedDecline') : t('approvals.reasonHelp')}
        closeLabel={t('common.close')}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get('note'));
            const r = rejecting!;
            void (r.kind === 'punch' ? decidePunches(r.ids, 'REJECT', note) : decideTimeOff(r.ids[0]!, 'DENY', note)).then(() => setRejecting(null));
          }}
        >
          <Field label={t('approvals.reason')}>{(p) => <Textarea {...p} name="note" required maxLength={500} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'punch-REJECT' || (rejecting ? busy === `DENY-${rejecting.ids[0]}` : false)}>
              {rejecting?.kind === 'punch' ? t('approvals.reject') : t('approvals.decline')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Who would be skipped in the overtime order if this claim is approved. */
function ClaimFairness({ shiftId, userId }: { shiftId: string; userId: string }) {
  const check = useQuery<{ overtime: boolean; skipped: Array<{ userId: string; name: string; chargedHours: number; seniorityDate: string | null }>; clause: string | null }>(`/api/overtime/check?shiftId=${shiftId}&userId=${userId}`);
  return check.data?.overtime ? <OvertimeOrder skipped={check.data.skipped} clause={check.data.clause} /> : null;
}

/** "Recorded offline · clock-in sent at 11:45 a.m." — when it happened (above) vs when it reached us. */
function OfflineNote({ p, lng }: { p: Punch; lng: string }) {
  const { t } = useTranslation();
  const when = (at: string, happened: string) => (at.slice(0, 10) === happened.slice(0, 10) ? formatTime(at, lng) : `${formatDate(at, lng)} ${formatTime(at, lng)}`);
  const parts = [
    p.localClockInReceivedAt ? t('approvals.offline.inSent', { time: when(p.localClockInReceivedAt, p.localClockIn) }) : null,
    p.localClockOutReceivedAt && p.localClockOut ? t('approvals.offline.outSent', { time: when(p.localClockOutReceivedAt, p.localClockOut) }) : null,
  ].filter(Boolean);
  const skewMin = p.clockSkewS ? Math.round(Math.abs(p.clockSkewS) / 60) : 0;
  return (
    <p className="mt-0.5 text-caption tabular-nums text-muted">
      {t('approvals.offline.recorded')}
      {parts.length ? ` · ${parts.join(' · ')}` : ''}
      {skewMin >= 1 ? ` · ${t('approvals.offline.clockOff', { count: skewMin })}` : ''}
    </p>
  );
}

/** A facility-local "2026-11-14T06:30:00.000-08:00" as the value of a date-time input ("2026-11-14T06:30"). */
const pickerValue = (local: string | null | undefined) => (local ? local.slice(0, 16) : '');

/**
 * The night clocks go back, 1:30 happens twice: the server says so (AMBIGUOUS_TIME, with the two
 * offsets) and the dialog asks which one, then sends the time with that offset.
 */
function useTwiceTime() {
  const [twice, setTwice] = useState<{ field: string; offsets: string[] } | null>(null);
  const [offset, setOffset] = useState('');
  const send = <R,>(fn: () => Promise<R>) => async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AMBIGUOUS_TIME') {
        const d = e.details as { field: string; offsets: string[] };
        setTwice(d);
        setOffset(d.offsets[0] ?? '');
      }
      throw e;
    }
  };
  const value = (field: string, local: string) => (twice?.field === field && offset ? `${local}${offset}` : local);
  return { twice, offset, setOffset, send, value };
}

function TwiceChoice({ twice, offset, setOffset }: Pick<ReturnType<typeof useTwiceTime>, 'twice' | 'offset' | 'setOffset'>) {
  const { t } = useTranslation();
  if (!twice) return null;
  return (
    <Field label={t(twice.field === 'localClockIn' ? 'approvals.whichClockIn' : 'approvals.whichClockOut')} hint={t('approvals.twiceHint')}>
      {(p) => (
        <Select {...p} value={offset} onChange={(e) => setOffset(e.target.value)}>
          {twice.offsets.map((o, i) => (
            <option key={o} value={o}>
              {t(i === 0 ? 'approvals.firstOccurrence' : 'approvals.secondOccurrence', { offset: `UTC${o}` })}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Correct a punch's times (or add the missing clock-out), with a reason the person sees. */
function EditPunchDialog({ punch, onClose, onSaved }: { punch: Punch; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const twice = useTwiceTime();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const localIn = String(f.get('in') ?? '');
    const localOut = String(f.get('out') ?? '');
    const body = {
      ...(localIn && localIn !== pickerValue(punch.localClockIn) ? { localClockIn: twice.value('localClockIn', localIn) } : {}),
      ...(localOut && localOut !== pickerValue(punch.localClockOut) ? { localClockOut: twice.value('localClockOut', localOut) } : {}),
      reason: String(f.get('reason') ?? '').trim(),
    };
    const ok = await run('editPunch', twice.send(() => api(`/api/punches/${punch.id}`, { method: 'PATCH', body })), t('approvals.punchCorrected', { name: punch.user.name }));
    if (ok !== undefined) await onSaved();
  }
  return (
    <Dialog open onClose={onClose} title={t('approvals.editTimesFor', { name: punch.user.name })} description={`${punch.facility.name} · ${t('approvals.facilityTime')}`} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('approvals.clockIn')}>{(p) => <Input {...p} name="in" type="datetime-local" required defaultValue={pickerValue(punch.localClockIn)} />}</Field>
          <Field label={t('approvals.clockOut')}>{(p) => <Input {...p} name="out" type="datetime-local" required={!punch.localClockOut} defaultValue={pickerValue(punch.localClockOut)} />}</Field>
        </div>
        <Field label={t('approvals.reason')} hint={t('approvals.correctionHint')}>{(p) => <Textarea {...p} name="reason" required minLength={3} maxLength={500} rows={2} />}</Field>
        <TwiceChoice twice={twice.twice} offset={twice.offset} setOffset={twice.setOffset} />
        {punch.status === 'APPROVED' || punch.status === 'REJECTED' ? <p className="rounded-xl bg-surface px-3 py-2 text-caption text-muted">{t('approvals.reapprovalNote')}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy === 'editPunch'}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A row of GET /api/users (it sends the full name as `name`). */
interface PersonOption { id: string; name: string; positions: Array<{ id: string; name: string; nameFr: string | null }> }

/** Add time someone worked but couldn't punch. It goes to the review queue like any punch. */
function AddPunchDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const people = useQuery<PersonOption[]>('/api/users?status=ACTIVE');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const twice = useTwiceTime();
  const [userId, setUserId] = useState('');
  const person = people.data?.find((p) => p.id === userId);
  const posName = (p: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && p.nameFr ? p.nameFr : p.name);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { userId, facilityId: String(f.get('facility')), positionId: String(f.get('position')), localClockIn: twice.value('localClockIn', String(f.get('in'))), localClockOut: twice.value('localClockOut', String(f.get('out'))), reason: String(f.get('reason') ?? '').trim() };
    const ok = await run('addPunch', twice.send(() => api('/api/punches', { method: 'POST', body })), t('approvals.punchAdded'));
    if (ok !== undefined) await onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={t('approvals.addPunch')} description={t('approvals.addPunchHelp')} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <Field label={t('approvals.person')}>
          {(p) => (
            <Select {...p} required value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {(people.data ?? [])
                .filter((x) => x.id !== me?.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('approvals.facility')}>
            {(p) => (
              <Select {...p} name="facility" required defaultValue="">
                <option value="">{t('common.choose')}</option>
                {(facilities.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('approvals.position')}>
            {(p) => (
              <Select {...p} key={userId} name="position" required defaultValue={person?.positions.length === 1 ? person.positions[0]!.id : ''}>
                <option value="">{t('common.choose')}</option>
                {(person?.positions ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {posName(x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('approvals.clockIn')}>{(p) => <Input {...p} name="in" type="datetime-local" required />}</Field>
          <Field label={t('approvals.clockOut')}>{(p) => <Input {...p} name="out" type="datetime-local" required />}</Field>
        </div>
        <p className="text-caption text-muted">{t('approvals.facilityTime')}</p>
        <TwiceChoice twice={twice.twice} offset={twice.offset} setOffset={twice.setOffset} />
        <Field label={t('approvals.reason')} hint={t('approvals.correctionHint')}>{(p) => <Textarea {...p} name="reason" required minLength={3} maxLength={500} rows={2} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy === 'addPunch'}>
            {t('approvals.addPunch')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
