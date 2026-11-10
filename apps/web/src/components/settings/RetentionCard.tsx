'use client';

import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

type Key = 'notificationsDays' | 'emailLogDays' | 'familiesInactiveDays' | 'bookingsDays';
interface Retention extends Record<Key, number> { limits: Record<Key, [number, number]> }
const KEYS: Key[] = ['notificationsDays', 'emailLogDays', 'familiesInactiveDays', 'bookingsDays'];

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
    const r = await run('save', () => api('/api/settings/retention', { method: 'PUT', body: Object.fromEntries(KEYS.map((k) => [k, Number(f.get(k))])) }), t('retention.saved'));
    if (r !== undefined) await data.reload();
  }
  return (
    <Card>
      <CardHeader title={t('retention.title')} description={t('retention.help')} />
      <CardBody className="pt-2">
        <form key={KEYS.map((k) => d[k]).join('-')} className="grid gap-4" onSubmit={(e) => void save(e)}>
          <div className="grid gap-4 sm:grid-cols-2">
            {KEYS.map((k) => (
              <Field key={k} label={t(`retention.${k}`)} hint={t('retention.range', { min: d.limits[k][0], max: d.limits[k][1] })}>
                {(p) => <Input {...p} name={k} type="number" min={d.limits[k][0]} max={d.limits[k][1]} defaultValue={d[k]} required />}
              </Field>
            ))}
          </div>
          <p className="text-caption text-muted">{t('retention.fixed')}</p>
          <div><Button type="submit" size="sm" loading={busy === 'save'}>{t('common.save')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
