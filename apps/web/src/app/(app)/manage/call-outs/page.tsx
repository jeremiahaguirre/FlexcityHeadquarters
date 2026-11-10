'use client';

import { PhoneCall, Phone, Siren } from 'lucide-react';
import { type FormEvent, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';
import { type CallOut, type CallOutContact, toLocalInput } from '@/lib/winter';
import { dateFormat } from '@/lib/format';

const TONE: Record<CallOutContact['status'], Tone> = { WAITING: 'neutral', OFFERED: 'new', ACCEPTED: 'ok', DECLINED: 'warn', NO_ANSWER: 'warn', SKIPPED: 'neutral', NOT_NEEDED: 'neutral' };

/** Storm call-outs: offered in overtime order, one person at a time, with phone answers recorded here. */
export default function CallOutsPage() {
  const { t, i18n } = useTranslation();
  const list = useQuery<CallOut[]>('/api/call-outs');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const { run, busy } = useAction();
  useEffect(() => {
    const id = setInterval(() => void list.reload(), 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const when = (iso: string) => dateFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const label = (p: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && p.nameFr ? p.nameFr : p.name);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = { facilityId: String(f.get('facility')), positionId: String(f.get('position')), reason: String(f.get('reason')), startsAt: new Date(String(f.get('start'))).toISOString(), endsAt: new Date(String(f.get('end'))).toISOString() };
    if ((await run('create', () => api('/api/call-outs', { method: 'POST', body }), t('callOuts.started'))) !== undefined) {
      form.reset();
      await list.reload();
    }
  }
  const record = (c: CallOut, x: CallOutContact, answer: 'ACCEPTED' | 'DECLINED' | 'NO_ANSWER') =>
    void run(`${x.id}${answer}`, () => api(`/api/call-outs/${c.id}/contacts/${x.id}`, { method: 'POST', body: { answer } }), t('callOuts.recorded')).then(() => list.reload());

  const now = new Date();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('callOuts.title')} description={t('callOuts.description')} />
      <Card>
        <CardHeader title={t('callOuts.new')} description={t('callOuts.newHelp')} />
        <CardBody className="pt-2">
          {!facilities.data || !positions.data ? (
            <Skeleton className="h-32" />
          ) : (
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void create(e)}>
              <Field label={t('callOuts.reason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} placeholder={t('callOuts.reasonPlaceholder')} />}</Field>
              <Field label={t('callOuts.position')}>{(p) => <Select {...p} name="position" required>{positions.data!.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>}</Field>
              <Field label={t('callOuts.facility')}>{(p) => <Select {...p} name="facility" required>{facilities.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                <Field label={t('callOuts.starts')}>{(p) => <Input {...p} name="start" type="datetime-local" required defaultValue={toLocalInput(new Date(now.getTime() + 3_600_000))} />}</Field>
                <Field label={t('callOuts.end')}>{(p) => <Input {...p} name="end" type="datetime-local" required defaultValue={toLocalInput(new Date(now.getTime() + 9 * 3_600_000))} />}</Field>
              </div>
              <Button type="submit" loading={busy === 'create'} icon={<Siren className="h-4 w-4" aria-hidden="true" />} className="justify-self-start">{t('callOuts.start')}</Button>
            </form>
          )}
        </CardBody>
      </Card>
      {!list.data ? (
        <Skeleton className="h-48" />
      ) : !list.data.length ? (
        <EmptyState icon={PhoneCall} title={t('callOuts.none')}>{t('callOuts.noneHelp')}</EmptyState>
      ) : (
        list.data.map((c) => (
          <Card key={c.id}>
            <CardHeader
              title={c.reason}
              description={`${c.position ? label(c.position) : ''} · ${c.facility} · ${when(c.startsAt)} – ${when(c.endsAt)}`}
              action={
                c.status === 'OPEN' ? (
                  <Button size="sm" variant="ghost" loading={busy === `x${c.id}`} onClick={() => void run(`x${c.id}`, () => api(`/api/call-outs/${c.id}/cancel`, { method: 'POST' }), t('callOuts.cancelled')).then(() => list.reload())}>{t('callOuts.cancel')}</Button>
                ) : (
                  <StatusPill tone={c.status === 'FILLED' ? 'ok' : 'neutral'}>{c.status === 'FILLED' ? t('callOuts.filledBy', { name: c.filledBy }) : t('callOuts.wasCancelled')}</StatusPill>
                )
              }
            />
            <CardBody className="pt-1">
              <ol className="divide-y divide-line">
                {c.contacts.map((x, n) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-small">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="w-6 text-right tabular-nums text-muted">{n + 1}</span>
                      <span className="font-semibold">{x.name}</span>
                      <StatusPill tone={TONE[x.status]}>{t(`callOuts.status.${x.status}`)}</StatusPill>
                      {x.skipReason ? <span className="text-caption text-muted">{t(`callOuts.skip.${x.skipReason}`, { defaultValue: t('callOuts.skip.OTHER') })}</span> : null}
                    </div>
                    {x.status === 'OFFERED' && c.status === 'OPEN' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {x.phone ? <a href={`tel:${x.phone}`} className="inline-flex items-center gap-1 font-semibold text-brand-text hover:underline"><Phone className="h-4 w-4" aria-hidden="true" />{x.phone}</a> : null}
                        <span className="text-caption text-muted">{t('callOuts.answerBy', { time: dateFormat(i18n.language, { timeStyle: 'short' }).format(new Date(new Date(x.offeredAt!).getTime() + c.responseMinutes * 60_000)) })}</span>
                        <Button size="sm" loading={busy === `${x.id}ACCEPTED`} onClick={() => record(c, x, 'ACCEPTED')}>{t('callOuts.yes')}</Button>
                        <Button size="sm" variant="secondary" loading={busy === `${x.id}DECLINED`} onClick={() => record(c, x, 'DECLINED')}>{t('callOuts.no')}</Button>
                        <Button size="sm" variant="ghost" loading={busy === `${x.id}NO_ANSWER`} onClick={() => record(c, x, 'NO_ANSWER')}>{t('callOuts.noAnswer')}</Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              {!c.contacts.length ? <p className="text-small text-muted">{t('callOuts.nobodyQualified')}</p> : null}
            </CardBody>
          </Card>
        ))
      )}
      <p className="text-caption text-muted">{t('callOuts.foot')}</p>
    </div>
  );
}
