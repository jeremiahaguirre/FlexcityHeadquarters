'use client';

import { Coffee, HeartHandshake } from 'lucide-react';
import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

interface CheckIn { id: string; status: 'OFFERED' | 'CHECKED_IN' | 'DECLINED'; dueAt: string; breakAskedAt: string | null; completedAt: string | null; person: string; incident: { category: string; occurredAt: string; facility: string } | null }

/** Follow-up after critical incidents: who to check on, and the city's support details. */
export default function CarePage() {
  const { t, i18n } = useTranslation();
  const list = useQuery<CheckIn[]>('/api/care/checkins');
  const settings = useQuery<{ eap: string | null }>('/api/care/settings');
  const { run, busy } = useAction();
  const when = (iso: string) => dateFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const open = (list.data ?? []).filter((c) => c.status === 'OFFERED');
  const closed = (list.data ?? []).filter((c) => c.status !== 'OFFERED');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const eap = String(new FormData(e.currentTarget).get('eap') || '') || null;
    await run('eap', () => api('/api/care/settings', { method: 'PUT', body: { eap } }), t('care.saved'));
    await settings.reload();
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('care.title')} description={t('care.description')} />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title={t('care.toCheck', { count: open.length })} description={t('care.toCheckHelp')} />
          <CardBody className="pt-2">
            {!list.data ? (
              <Skeleton className="h-40" />
            ) : !open.length ? (
              <EmptyState icon={HeartHandshake} title={t('care.none')}>{t('care.noneHelp')}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-small">
                    <div>
                      <p className="font-semibold">{c.person}</p>
                      <p className="text-caption text-muted">{c.incident ? `${t(`incidents.categories.${c.incident.category}`, { defaultValue: c.incident.category })} · ${c.incident.facility} · ${when(c.incident.occurredAt)}` : ''}</p>
                      {c.breakAskedAt ? <StatusPill tone="warn" className="mt-1" icon={<Coffee className="h-3.5 w-3.5" aria-hidden="true" />}>{t('care.askedBreak', { time: when(c.breakAskedAt) })}</StatusPill> : null}
                    </div>
                    <Button size="sm" loading={busy === c.id} onClick={() => void run(c.id, () => api(`/api/care/checkins/${c.id}/done`, { method: 'POST' }), t('care.recorded')).then(() => list.reload())}>{t('care.checkedIn')}</Button>
                  </li>
                ))}
              </ul>
            )}
            {closed.length ? <p className="mt-4 text-caption text-muted">{t('care.closed', { count: closed.length })}</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('care.support')} description={t('care.supportHelp')} />
          <CardBody className="pt-2">
            {settings.data ? (
              <form key={settings.data.eap ?? ''} className="grid gap-4" onSubmit={(e) => void save(e)}>
                <Field label={t('care.eap')} hint={t('care.eapHint')}>{(p) => <Textarea {...p} name="eap" maxLength={500} defaultValue={settings.data!.eap ?? ''} />}</Field>
                <Button type="submit" loading={busy === 'eap'} className="justify-self-start">{t('common.save')}</Button>
              </form>
            ) : <Skeleton className="h-32" />}
            <p className="mt-4 text-caption text-muted">{t('care.privacy')}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
