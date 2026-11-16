'use client';

import { OvertimeOrder } from '@/components/OvertimeOrder';
import { CalendarPlus, Check, ClipboardCheck, Pencil, X } from 'lucide-react';
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
import { formatDate, formatDuration, formatHours, formatSpan, formatTime, formatTimeRange } from '@/lib/format';
import { LONG_PUNCH_HOURS } from '@/lib/punch';
import { useSession } from '@/lib/session';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';

interface Claim { id: string; claimant: { id: string; name: string } | null; complianceSnapshot: { overtimeHours?: string } | null; shift: ShiftLike & { id: string } }
interface TimeOff { id: string; type: string; startsAt: string; endsAt: string; note: string | null; user: { name: string }; affectedShifts: number }
interface Punch {
  id: string;
  user: { name: string };
  facility: { name: string };
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
}
type Tab = 'claims' | 'trades' | 'timeoff' | 'punches';
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
  // Approved time off still to come or under way, to end early or cancel (supervisors and HR leave administrators).
  const leaveAdmin = can('timeoff.approve') || can('leave.manage');
  const [leaveView, setLeaveView] = useState<'PENDING' | 'APPROVED'>(can('timeoff.approve') ? 'PENDING' : 'APPROVED');
  const approvedLeave = useQuery<TimeOff[]>(ready && leaveAdmin && leaveView === 'APPROVED' ? `/api/time-off?status=APPROVED${scope.query ? `&${scope.query}` : ''}` : null);
  const [revising, setRevising] = useState<TimeOff | null>(null);
  const [recording, setRecording] = useState(false);
  const punches = useQuery<Punch[]>(ready && can('timeclock.review') ? `/api/punches${tq}` : null);
  const [tab, setTab] = useState<Tab>('claims');
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
  const order: Tab[] = ['claims', 'timeoff', 'punches', ...(can('shiftboard.approve') ? (['trades'] as const) : [])];
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
  const reviewable = punches.data?.filter((p) => p.localClockOut) ?? [];

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
            options={[
              { value: 'claims', label: label('claims') },
              { value: 'timeoff', label: label('timeoff') },
              { value: 'punches', label: label('punches') },
              ...(can('shiftboard.approve') ? [{ value: 'trades' as const, label: label('trades') }] : []),
            ]}
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

      {tab === 'timeoff' && leaveAdmin ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {can('timeoff.approve') ? (
            <Segmented
              label={t('approvals.leaveView')}
              value={leaveView}
              onChange={setLeaveView}
              options={[
                { value: 'PENDING', label: t('approvals.leaveViews.PENDING') },
                { value: 'APPROVED', label: t('approvals.leaveViews.APPROVED') },
              ]}
            />
          ) : (
            <span />
          )}
          {can('users.read') ? (
            <Button size="sm" variant="secondary" icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRecording(true)}>
              {t('approvals.recordTimeOff')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {tab === 'timeoff' && leaveView === 'APPROVED' ? (
        approvedLeave.loading || !approvedLeave.data ? (
          <ListSkeleton />
        ) : !approvedLeave.data.length ? (
          <EmptyState icon={ClipboardCheck} title={t('approvals.noApprovedLeave')}>
            {t('approvals.noApprovedLeaveHelp')}
          </EmptyState>
        ) : (
          <div className="grid gap-3">
            {approvedLeave.data.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-subheading">{r.user.name}</p>
                  <p className="text-small text-muted">
                    {t(`timeOff.types.${r.type}`)} · {formatDate(r.startsAt, lng)} – {formatDate(new Date(new Date(r.endsAt).getTime() - 1).toISOString(), lng)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} aria-label={t('approvals.changeLeaveFor', { name: r.user.name })} onClick={() => setRevising(r)}>
                  {t('approvals.changeLeave')}
                </Button>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'timeoff' && leaveView === 'PENDING' ? (
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
                    disabled={!p.localClockOut}
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
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      {revising ? (
        <ReviseLeaveDialog
          request={revising}
          onClose={() => setRevising(null)}
          onSaved={async () => {
            setRevising(null);
            await approvedLeave.reload();
          }}
        />
      ) : null}
      {recording ? (
        <RecordLeaveDialog
          onClose={() => setRecording(false)}
          onSaved={async () => {
            setRecording(false);
            await approvedLeave.reload();
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

/** A local date on this device → the instant its day starts (time off is entered in the approver's own time zone, as staff enter it). */
const dayStart = (date: string, plus = 0) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + plus);
  return d.toISOString();
};
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** End approved time off early, or cancel it. The person sees the reason; shifts nobody took come back to them. */
function ReviseLeaveDialog({ request, onClose, onSaved }: { request: TimeOff; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [action, setAction] = useState<'END_EARLY' | 'CANCEL'>('END_EARLY');
  const firstDay = localDay(request.startsAt);
  const lastDay = localDay(new Date(new Date(request.endsAt).getTime() - 1).toISOString());
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { action, reason: String(f.get('reason') ?? '').trim(), ...(action === 'END_EARLY' ? { endsAt: dayStart(String(f.get('last')), 1) } : {}) };
    const r = await run('revise', () => api<{ restoredShifts: number }>(`/api/time-off/${request.id}/revise`, { method: 'POST', body }));
    if (r !== undefined) {
      await onSaved();
    }
  }
  return (
    <Dialog open onClose={onClose} title={t('approvals.changeLeaveFor', { name: request.user.name })} description={t('approvals.changeLeaveHelp')} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t('approvals.changeLeave')}</legend>
          {(['END_EARLY', 'CANCEL'] as const).map((a) => (
            <label key={a} className="flex items-center gap-2 text-small">
              <input type="radio" name="action" value={a} checked={action === a} onChange={() => setAction(a)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
              {t(`approvals.leaveActions.${a}`)}
            </label>
          ))}
        </fieldset>
        {action === 'END_EARLY' ? (
          <Field label={t('approvals.newLastDay')}>{(p) => <Input {...p} name="last" type="date" required min={firstDay} max={lastDay === firstDay ? firstDay : plusDays(lastDay, -1)} />}</Field>
        ) : null}
        <Field label={t('approvals.reason')} hint={t('approvals.changeLeaveReason')}>{(p) => <Textarea {...p} name="reason" required minLength={3} maxLength={500} rows={2} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant={action === 'CANCEL' ? 'danger' : 'primary'} loading={busy === 'revise'}>
            {t(`approvals.leaveActions.${action}`)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const LEAVE_TYPES = ['SICK', 'VACATION', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER'] as const;

/** Record time off for someone (they called in sick): saved as approved, up to two weeks back. */
function RecordLeaveDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { me } = useSession();
  const people = useQuery<Array<{ id: string; firstName: string; lastName: string }>>('/api/users?status=ACTIVE');
  const { run, busy } = useAction();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const from = String(f.get('from'));
    const to = String(f.get('to') || from);
    const body = { type: String(f.get('type')), startsAt: dayStart(from), endsAt: dayStart(to < from ? from : to, 1), note: String(f.get('note') ?? '').trim() || null };
    const r = await run('record', () => api(`/api/users/${String(f.get('person'))}/time-off`, { method: 'POST', body }), t('approvals.timeOffRecorded'));
    if (r !== undefined) await onSaved();
  }
  return (
    <Dialog open onClose={onClose} title={t('approvals.recordTimeOff')} description={t('approvals.recordTimeOffHelp')} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        <Field label={t('approvals.person')}>
          {(p) => (
            <Select {...p} name="person" required defaultValue="">
              <option value="">{t('common.choose')}</option>
              {(people.data ?? [])
                .filter((x) => x.id !== me?.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.firstName} {x.lastName}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t('timeOff.type')}>
          {(p) => (
            <Select {...p} name="type" defaultValue="SICK">
              {LEAVE_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`timeOff.types.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('timeOff.from')}>{(p) => <Input {...p} name="from" type="date" required min={plusDays(todayIso(), -14)} />}</Field>
          <Field label={t('timeOff.to')}>{(p) => <Input {...p} name="to" type="date" min={plusDays(todayIso(), -14)} />}</Field>
        </div>
        <Field label={t('timeOff.note')} hint={t('approvals.recordNoteHint')}>{(p) => <Textarea {...p} name="note" maxLength={500} rows={2} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy === 'record'}>
            {t('approvals.recordTimeOff')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
