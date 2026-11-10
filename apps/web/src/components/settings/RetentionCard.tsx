'use client';

import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

interface Retention { notificationsDays: number; emailLogDays: number; limits: { notificationsDays: [number, number]; emailLogDays: [number, number] } }

/** How long routine records are kept before they're deleted automatically. */
export function RetentionCard() {
  const { t } = useTranslation();
  const data = useQuery<Retention>('/api/settings/retention');
  const { run, busy } = useAction();
  if (data.error || !data.data) return null;
  const d = data.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('save', () => api('/api/settings/retention', { method: 'PUT', body: { notificationsDays: Number(f.get('notificationsDays')), emailLogDays: Number(f.get('emailLogDays')) } }), t('retention.saved'));
    if (r !== undefined) await data.reload();
  }
  return (
    <Card>
      <CardHeader title={t('retention.title')} description={t('retention.help')} />
      <CardBody className="pt-2">
        <form key={`${d.notificationsDays}-${d.emailLogDays}`} className="grid gap-4" onSubmit={(e) => void save(e)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('retention.notifications')} hint={t('retention.range', { min: d.limits.notificationsDays[0], max: d.limits.notificationsDays[1] })}>
              {(p) => <Input {...p} name="notificationsDays" type="number" min={d.limits.notificationsDays[0]} max={d.limits.notificationsDays[1]} defaultValue={d.notificationsDays} required />}
            </Field>
            <Field label={t('retention.emailLog')} hint={t('retention.range', { min: d.limits.emailLogDays[0], max: d.limits.emailLogDays[1] })}>
              {(p) => <Input {...p} name="emailLogDays" type="number" min={d.limits.emailLogDays[0]} max={d.limits.emailLogDays[1]} defaultValue={d.emailLogDays} required />}
            </Field>
          </div>
          <p className="text-caption text-muted">{t('retention.fixed')}</p>
          <div><Button type="submit" size="sm" loading={busy === 'save'}>{t('common.save')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
