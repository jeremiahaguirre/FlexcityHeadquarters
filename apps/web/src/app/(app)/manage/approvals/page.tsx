'use client';

import { OvertimeOrder } from '@/components/OvertimeOrder';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShiftCard, type ShiftLike } from '@/components/ShiftCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { TradeApprovals } from '@/components/shiftboard/Trades';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatHours, formatTime, formatTimeRange } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

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

export default function ApprovalsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const claims = useQuery<Claim[]>(can('shiftboard.approve') ? '/api/offers/pending' : null);
  const timeOff = useQuery<TimeOff[]>(can('timeoff.approve') ? '/api/time-off' : null);
  const punches = useQuery<Punch[]>(can('timeclock.review') ? '/api/punches' : null);
  const [tab, setTab] = useState<Tab>('claims');
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<{ kind: 'punch' | 'timeoff'; ids: string[]; protectedLeave?: boolean } | null>(null);

  const trades = useQuery<unknown[]>(can('shiftboard.approve') ? '/api/trades' : null);
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
            onChange={setTab}
            options={[
              { value: 'claims', label: label('claims') },
              { value: 'timeoff', label: label('timeoff') },
              { value: 'punches', label: label('punches') },
              ...(can('shiftboard.approve') ? [{ value: 'trades' as const, label: label('trades') }] : []),
            ]}
          />
        }
      />

      {tab === 'claims' ? (
        claims.loading ? (
          <ListSkeleton />
        ) : !claims.data?.length ? (
          <EmptyState icon={ClipboardCheck} title={t('approvals.allClear')}>
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
          <EmptyState icon={ClipboardCheck} title={t('approvals.allClear')}>
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

      {tab === 'trades' ? <TradeApprovals /> : null}

      {tab === 'punches' ? (
        punches.loading ? (
          <ListSkeleton />
        ) : !punches.data?.length ? (
          <EmptyState icon={ClipboardCheck} title={t('approvals.allClear')}>
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
                  {t('approvals.approveSelected', { count: selected.size })}
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
                      {t('approvals.punched')}: {p.localClockOut ? formatTimeRange(p.localClockIn, p.localClockOut, lng) : `${formatTime(p.localClockIn, lng)} – …`}
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
                    {p.hours != null ? <span className="ml-1 text-small font-semibold tabular-nums">{formatHours(p.hours, lng, 'payroll')}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
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
