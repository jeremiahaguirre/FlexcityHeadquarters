'use client';

/** One shift's details: who can work it (ranked by the API), unassign, cancel. */
import { OvertimeOrder, type Skipped } from '@/components/OvertimeOrder';
import { UserCheck, UserMinus, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatHours, formatTimeRange } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

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
}
interface Candidate { user: { id: string; firstName: string; lastName: string; employmentStatus: string }; eligible: boolean; overtimeHours: string; weeklyHoursAfter: string; blocks: Array<{ code: string }> }

export function ShiftDialog({ shift, onClose, onChanged }: { shift: DialogShift; onClose: () => void; onChanged: (change?: { from: string | null; to: string | null }) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const candidates = useQuery<{ shiftVersion: number; candidates: Candidate[] }>(`/api/shifts/${shift.id}/candidates`);
  const [busy, setBusy] = useState<string | null>(null);
  const [ackFor, setAckFor] = useState<{ userId: string; hours: string; skipped: Skipped[]; clause: string | null } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function assign(userId: string | null, acknowledgeOvertime = false) {
    setBusy(userId ?? 'none');
    try {
      await api(`/api/shifts/${shift.id}/assign`, { method: 'POST', body: { userId, expectedVersion: candidates.data?.shiftVersion ?? shift.version, acknowledgeOvertime } });
      toast(userId ? t('builder.assigned') : t('builder.unassigned'), 'ok');
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
