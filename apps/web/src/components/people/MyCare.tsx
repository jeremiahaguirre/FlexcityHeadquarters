'use client';

import { Coffee, HeartHandshake } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

/** After a critical incident: a kind check-in with support details and two simple choices. */
export function MyCare() {
  const { t } = useTranslation();
  const care = useQuery<{ open: Array<{ id: string; breakAskedAt: string | null }>; eap: string | null }>('/api/me/care');
  const { run, busy } = useAction();
  const c = care.data?.open[0];
  if (!c) return null;
  return (
    <section className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
      <h2 className="flex items-center gap-2 text-heading"><HeartHandshake className="h-6 w-6 text-brand-text" aria-hidden="true" />{t('care.mineTitle')}</h2>
      <p className="mt-2 text-small leading-6">{t('care.mineBody')}</p>
      {care.data?.eap ? <p className="mt-3 whitespace-pre-wrap rounded-xl bg-panel px-4 py-3 text-small font-semibold">{care.data.eap}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {c.breakAskedAt ? (
          <p className="text-small text-ok">{t('care.breakSent')}</p>
        ) : (
          <Button size="sm" icon={<Coffee className="h-4 w-4" aria-hidden="true" />} loading={busy === 'break'} onClick={() => void run('break', () => api(`/api/me/care/${c.id}/break`, { method: 'POST' }), t('care.breakSent')).then(() => care.reload())}>{t('care.askBreak')}</Button>
        )}
        <Button size="sm" variant="ghost" loading={busy === 'ok'} onClick={() => void run('ok', () => api(`/api/me/care/${c.id}/decline`, { method: 'POST' })).then(() => care.reload())}>{t('care.imOkay')}</Button>
      </div>
    </section>
  );
}
