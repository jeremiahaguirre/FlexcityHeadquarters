'use client';

import { CalendarClock, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery, todayIso } from '@/lib/useQuery';

type Status = 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';
interface Request {
  id: string;
  type: string;
  status: Status;
  startsAt: string;
  endsAt: string;
  note: string | null;
  decisionNote: string | null;
}
const TONE: Record<Status, Tone> = { PENDING: 'neutral', APPROVED: 'ok', DENIED: 'warn', CANCELLED: 'neutral' };
const TYPES = ['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER'] as const;

/** Local date + optional time on this device → instant. Staff request time off in their own time zone. */
const toInstant = (date: string, time: string) => new Date(`${date}T${time || '00:00'}:00`).toISOString();

export default function TimeOffPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const list = useQuery<Request[]>('/api/me/time-off');
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>('VACATION');
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = (iso: string) => new Intl.DateTimeFormat(lng, { weekday: 'short', month: 'short', day: 'numeric', ...(partial ? {} : {}) }).format(new Date(iso));
  const fmtRange = (r: Request) => {
    const s = new Date(r.startsAt);
    const e = new Date(new Date(r.endsAt).getTime() - 1);
    const sameDay = s.toDateString() === e.toDateString();
    const timeFmt = new Intl.DateTimeFormat(lng, { hour: 'numeric', minute: '2-digit' });
    const allDay = s.getHours() === 0 && s.getMinutes() === 0 && new Date(r.endsAt).getHours() === 0;
    if (sameDay && !allDay) return `${fmt(r.startsAt)} · ${timeFmt.format(s)}–${timeFmt.format(new Date(r.endsAt))}`;
    return sameDay ? fmt(r.startsAt) : `${fmt(r.startsAt)} – ${fmt(e.toISOString())}`;
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const startDate = String(f.get('startDate'));
    const endDate = String(f.get('endDate') || startDate);
    if (endDate < startDate) return setError(t('timeOff.endBeforeStart'));
    const startsAt = partial ? toInstant(startDate, String(f.get('startTime'))) : toInstant(startDate, '00:00');
    const endsAt = partial ? toInstant(startDate, String(f.get('endTime'))) : (() => {
      const d = new Date(`${endDate}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return d.toISOString();
    })();
    if (endsAt <= startsAt) return setError(t('timeOff.endBeforeStart'));
    setError(null);
    const r = await run('submit', () => api<{ affectedShifts: number }>('/api/me/time-off', { method: 'POST', body: { type, startsAt, endsAt, note: String(f.get('note') || '') || null } }));
    if (r) {
      setOpen(false);
      setPartial(false);
      await list.reload();
    }
  }

  return (
    <>
      <PageHeader
        title={t('timeOff.title')}
        description={t('timeOff.description')}
        actions={
          <Button icon={<Plus className="h-5 w-5" aria-hidden="true" />} onClick={() => setOpen(true)}>
            {t('timeOff.request')}
          </Button>
        }
      />
      {list.loading ? (
        <ListSkeleton />
      ) : list.error ? (
        <ErrorNotice onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon={CalendarClock} title={t('timeOff.emptyTitle')}>
          {t('timeOff.emptyBody')}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {list.data.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-subheading">{t(`timeOff.types.${r.type}`)}</p>
                <p className="text-small text-muted">{fmtRange(r)}</p>
                {r.decisionNote ? <p className="mt-1 text-small text-ink">“{r.decisionNote}”</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={TONE[r.status]}>{t(`timeOff.status.${r.status}`)}</StatusPill>
                {(r.status === 'PENDING' || (r.status === 'APPROVED' && new Date(r.startsAt) > new Date())) && (
                  <Button variant="ghost" size="sm" loading={busy === r.id} onClick={() => void run(r.id, () => api(`/api/me/time-off/${r.id}/cancel`, { method: 'POST' }), t('timeOff.cancelled')).then(() => list.reload())}>
                    {t('timeOff.cancel')}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title={t('timeOff.request')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <Field label={t('timeOff.type')} hint={type === 'SICK' || type === 'PROTECTED_LEAVE' ? t('timeOff.protectedHint') : undefined}>
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`timeOff.types.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 text-small font-semibold">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
            {t('timeOff.partOfDay')}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={partial ? t('timeOff.date') : t('timeOff.from')}>{(p) => <Input {...p} type="date" name="startDate" min={todayIso()} required />}</Field>
            {partial ? null : <Field label={t('timeOff.to')}>{(p) => <Input {...p} type="date" name="endDate" min={todayIso()} />}</Field>}
            {partial ? (
              <>
                <Field label={t('timeOff.startTime')}>{(p) => <Input {...p} type="time" name="startTime" required />}</Field>
                <Field label={t('timeOff.endTime')}>{(p) => <Input {...p} type="time" name="endTime" required />}</Field>
              </>
            ) : null}
          </div>
          <Field label={t('timeOff.note')} hint={t('timeOff.noteHint')} error={error ?? undefined}>
            {(p) => <Textarea {...p} name="note" maxLength={500} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={busy === 'submit'}>
              {t('timeOff.send')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
