'use client';

/** One shift's details: who can work it (ranked by the API), unassign, cancel. */
import { OvertimeOrder, type Skipped } from '@/components/OvertimeOrder';
import { UserCheck, UserMinus, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatHours, formatTimeRange } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import type { ChangeEffect, ChangePreview, ShiftWarning } from '@/lib/workRules';

interface Position { id: string; name: string; nameFr: string | null }
export interface DialogShift {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
  localStartsAt: string;
  localEndsAt: string;
  hours: number;
  position: Position;
  customTitle: string | null;
  assignee: { id: string; name: string } | null;
  unpaidBreakMinutes?: number;
  ownBreakMinutes?: number | null;
  neverAlone?: boolean;
  ownNeverAlone?: boolean | null;
  warnings?: ShiftWarning[];
}
interface Candidate { user: { id: string; firstName: string; lastName: string; employmentStatus: string }; eligible: boolean; overtimeHours: string; weeklyHoursAfter: string; blocks: Array<{ code: string }>; flags?: Array<{ code: string }> }

export function ShiftDialog({ shift, onClose, onChanged }: { shift: DialogShift; onClose: () => void; onChanged: (change?: { from: string | null; to: string | null }) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const candidates = useQuery<{ shiftVersion: number; candidates: Candidate[] }>(`/api/shifts/${shift.id}/candidates`);
  const [busy, setBusy] = useState<string | null>(null);
  const [ackFor, setAckFor] = useState<{ userId: string; hours: string; skipped: Skipped[]; clause: string | null } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // A change to a published shift with less notice than the agreement asks: shown before saving.
  const [late, setLate] = useState<{ effects: ChangeEffect[]; go: () => void } | null>(null);
  const [lateOkFor, setLateOkFor] = useState<string | null>(null);
  async function checkLate(key: string, proposal: { userId?: string | null; cancel?: boolean }, go: () => void) {
    if (shift.status !== 'PUBLISHED' || lateOkFor === key) return true;
    try {
      const r = await api<ChangePreview>(`/api/shifts/${shift.id}/change-preview`, { method: 'POST', body: proposal });
      if (!r.late) return true;
      setLate({ effects: r.effects.filter((x) => x.late), go: () => { setLateOkFor(key); setLate(null); go(); } });
      return false;
    } catch {
      return true;
    }
  }
  const [brk, setBrk] = useState<string>(shift.ownBreakMinutes == null ? '' : String(shift.ownBreakMinutes));
  const [alone, setAlone] = useState<string>(shift.ownNeverAlone == null ? '' : String(shift.ownNeverAlone));
  async function saveRules() {
    setBusy('rules');
    try {
      await api(`/api/shifts/${shift.id}`, { method: 'PATCH', body: { expectedVersion: candidates.data?.shiftVersion ?? shift.version, unpaidBreakMinutes: brk === '' ? null : Number(brk), neverAlone: alone === '' ? null : alone === 'true' } });
      toast(t('workRules.saved'), 'ok');
      onChanged();
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function assign(userId: string | null, acknowledgeOvertime = false) {
    if (!(await checkLate(`assign:${userId}`, { userId }, () => void assign(userId, acknowledgeOvertime)))) return;
    setBusy(userId ?? 'none');
    try {
      const r = await api<{ flags?: Array<{ code: string }> }>(`/api/shifts/${shift.id}/assign`, { method: 'POST', body: { userId, expectedVersion: candidates.data?.shiftVersion ?? shift.version, acknowledgeOvertime } });
      // Assigned, but young-worker rules couldn't be checked without a date of birth.
      if (userId && r.flags?.some((f) => f.code === 'DATE_OF_BIRTH_MISSING')) toast(t('builder.assignedNoDob'), 'warn');
      else toast(userId ? t('builder.assigned') : t('builder.unassigned'), 'ok');
      onChanged({ from: shift.assignee?.id ?? null, to: userId });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERTIME_REQUIRES_ACK' && userId) setAckFor({ userId, ...(e.details as { overtimeHours: string; skipped?: Skipped[]; clause?: string | null }), hours: (e.details as { overtimeHours: string }).overtimeHours, skipped: (e.details as { skipped?: Skipped[] }).skipped ?? [], clause: (e.details as { clause?: string | null }).clause ?? null });
      else toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function cancel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get('reason'));
    if (!(await checkLate('cancel', { cancel: true }, () => void doCancel(reason)))) return;
    await doCancel(reason);
  }
  async function doCancel(reason: string) {
    setBusy('cancel');
    try {
      await api(`/api/shifts/${shift.id}/cancel`, { method: 'POST', body: { reason } });
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
          {shift.unpaidBreakMinutes ? <StatusPill tone="neutral">{t('planner.breakPill', { minutes: shift.unpaidBreakMinutes })}</StatusPill> : null}
          {shift.neverAlone ? <StatusPill tone="brand">{t('planner.neverAlone')}</StatusPill> : null}
        </div>
        {shift.warnings?.length ? (
          <ul className="grid gap-1 rounded-xl bg-warn-bg p-3 text-small">
            {shift.warnings.map((w, i) => <li key={i}>{t(`planner.warn.${w.code}`, { a: w.n[0], b: w.n[1] })}</li>)}
          </ul>
        ) : null}

        {late ? (
          <div className="grid gap-2 rounded-xl bg-warn-bg p-4 text-small" role="alert">
            <p className="font-semibold">{t('planner.late.title')}</p>
            {late.effects.map((e, i) => (
              <p key={i}>
                {t(`planner.late.${e.kind}`, { name: candidates.data?.candidates.find((c) => c.user.id === e.userId) ? `${candidates.data.candidates.find((c) => c.user.id === e.userId)!.user.firstName}` : e.userId === shift.assignee?.id ? shift.assignee.name : t('planner.late.someone'), hours: e.noticeHours, required: e.requiredHours ?? 0 })}{' '}
                {e.premiumHours ? t('planner.late.premiumHours', { hours: e.premiumHours, m: e.multiplier }) : e.flatAmount ? t('planner.late.flat', { amount: e.flatAmount }) : t('planner.late.noPremium')}
              </p>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setLate(null)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={late.go}>{t('planner.late.confirm')}</Button>
            </div>
          </div>
        ) : null}

        {ackFor ? (
          <div className="rounded-xl bg-warn-bg p-4">
            <p className="text-small text-ink">{t('builder.overtimeAsk', { hours: ackFor.hours })}</p>
            <OvertimeOrder skipped={ackFor.skipped} clause={ackFor.clause} />
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
                      {c.eligible && c.flags?.some((f) => f.code === 'DATE_OF_BIRTH_MISSING') ? <p className="text-caption text-warn">{t('planner.reasons.DATE_OF_BIRTH_MISSING')}</p> : null}
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
        <details className="rounded-xl border border-line p-3">
          <summary className="min-h-11 cursor-pointer content-center text-small font-semibold">{t('planner.shiftRules')}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('planner.breakField')} hint={t('planner.breakFieldHelp')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={240} step={5} value={brk} placeholder={t('planner.positionDefault')} onChange={(e) => setBrk(e.target.value)} />}</Field>
            <Field label={t('planner.neverAlone')}>
              {(p) => (
                <Select {...p} value={alone} onChange={(e) => setAlone(e.target.value)}>
                  <option value="">{t('planner.positionDefault')}</option>
                  <option value="true">{t('workRules.yes')}</option>
                  <option value="false">{t('workRules.no')}</option>
                </Select>
              )}
            </Field>
          </div>
          <Button size="sm" variant="secondary" className="mt-3" loading={busy === 'rules'} onClick={() => void saveRules()}>{t('common.save')}</Button>
        </details>
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
