'use client';

import { MapPin, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { type LoneSession, type LoneStatus, mapLink } from '@/lib/loneWork';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

const TONE: Record<LoneStatus, Tone> = { HELP: 'danger', ESCALATED: 'danger', OVERDUE: 'warn', ACTIVE: 'ok', ENDED: 'neutral' };

/** Everyone working alone right now: problems first, refreshed every 20 seconds. */
export default function LoneWorkMonitor() {
  const { t, i18n } = useTranslation();
  const q = useQuery<LoneSession[]>('/api/lone-work');
  const { run, busy } = useAction();
  const [closing, setClosing] = useState<LoneSession | null>(null);
  useEffect(() => {
    const id = setInterval(() => void q.reload(), 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const time = (iso: string) => dateFormat(i18n.language, { timeStyle: 'short' }).format(new Date(iso));
  const open = (q.data ?? []).filter((s) => s.status !== 'ENDED');
  const ended = (q.data ?? []).filter((s) => s.status === 'ENDED');

  return (
    <div className="grid gap-6">
      <PageHeader title={t('loneWork.monitorTitle')} description={t('loneWork.monitorHelp')} />
      <Card>
        <CardHeader title={t('loneWork.working', { count: open.length })} />
        <CardBody className="pt-2">
          {!q.data ? (
            <Skeleton className="h-40" />
          ) : !open.length ? (
            <EmptyState icon={ShieldCheck} title={t('loneWork.nobody')}>{t('loneWork.nobodyHelp')}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {open.map((s) => (
                <li key={s.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{s.person}</p>
                      <StatusPill tone={TONE[s.status]}>{t(`loneWork.status.${s.status}`)}</StatusPill>
                    </div>
                    <p className="text-small">{s.location}{s.task ? ` · ${s.task}` : ''}</p>
                    {s.helpNote ? <p className="text-small font-semibold text-danger">“{s.helpNote}”</p> : null}
                    <p className="text-caption text-muted">
                      {t('loneWork.rowTimes', { last: time(s.lastCheckInAt), due: time(s.nextDueAt), count: s.intervalMinutes })}
                      {s.responder ? ` · ${t('loneWork.responding', { name: s.responder })}` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-small">
                      {s.phone ? <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 font-semibold text-brand-text hover:underline"><Phone className="h-4 w-4" aria-hidden="true" />{s.phone}</a> : null}
                      {s.latitude != null && s.longitude != null ? (
                        <a href={mapLink(s.latitude, s.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-text hover:underline"><MapPin className="h-4 w-4" aria-hidden="true" />{s.locationAt ? t('loneWork.mapAt', { time: time(s.locationAt) }) : t('loneWork.map')}{s.shareLocation ? ` · ${t('loneWork.live')}` : ''}</a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.status !== 'ACTIVE' ? (
                      <Button size="sm" variant={s.status === 'OVERDUE' ? 'secondary' : 'primary'} loading={busy === `r${s.id}`} icon={<UserRound className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(`r${s.id}`, () => api(`/api/lone-work/${s.id}/respond`, { method: 'POST' }), t('loneWork.youRespond')).then(() => q.reload())}>
                        {t('loneWork.respond')}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setClosing(s)}>{t('loneWork.close')}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {ended.length ? <p className="mt-4 text-caption text-muted">{t('loneWork.endedToday', { count: ended.length })}</p> : null}
        </CardBody>
      </Card>
      <p className="text-caption text-muted">{t('loneWork.monitorFoot')}</p>
      <Dialog open={!!closing} onClose={() => setClosing(null)} title={t('loneWork.closeTitle', { name: closing?.person ?? '' })} closeLabel={t('common.cancel')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get('note'));
            const s = closing!;
            setClosing(null);
            void run('close', () => api(`/api/lone-work/${s.id}/close`, { method: 'POST', body: { note } }), t('loneWork.closed')).then(() => q.reload());
          }}
        >
          <Field label={t('loneWork.closeNote')} hint={t('loneWork.closeHint')}>{(p) => <Input {...p} name="note" required minLength={3} maxLength={300} />}</Field>
          <Button type="submit" className="justify-self-start">{t('loneWork.close')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
