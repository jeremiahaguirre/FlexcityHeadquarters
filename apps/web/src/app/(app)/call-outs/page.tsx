'use client';

import { Check, PhoneCall, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

interface Offer { id: string; reason: string; startsAt: string; endsAt: string; facility: string; answerBy: string }

/** A call-out offered to me: say yes or no before the time runs out. */
export default function MyCallOuts() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Offer[]>('/api/me/call-outs');
  const { run, busy } = useAction();
  const when = (iso: string, timeOnly = false) => dateFormat(i18n.language, timeOnly ? { timeStyle: 'short' } : { weekday: 'short', dateStyle: undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const toast = useToast();
  // An acceptance is re-checked: if they can no longer take it (another shift since), they're told and the next person is asked.
  const answer = (o: Offer, a: 'ACCEPTED' | 'DECLINED') =>
    void run(`${o.id}${a}`, () => api<{ accepted?: boolean; skippedReason?: string | null }>(`/api/me/call-outs/${o.id}`, { method: 'POST', body: { answer: a } })).then((r) => {
      if (r) toast(a === 'ACCEPTED' && r.accepted === false ? t('myCallOuts.noLongerEligible', { reason: t(`callOuts.skip.${r.skippedReason}`, { defaultValue: t('callOuts.skip.OTHER') }) }) : t(a === 'ACCEPTED' ? 'myCallOuts.accepted' : 'myCallOuts.declined'), a === 'ACCEPTED' && r.accepted === false ? 'warn' : 'ok');
      return q.reload();
    });
  return (
    <div className="grid gap-6">
      <PageHeader title={t('myCallOuts.title')} description={t('myCallOuts.description')} />
      {!q.data ? (
        <Skeleton className="h-40" />
      ) : !q.data.length ? (
        <EmptyState icon={PhoneCall} title={t('myCallOuts.none')}>{t('myCallOuts.noneHelp')}</EmptyState>
      ) : (
        q.data.map((o) => (
          <Card key={o.id} className="max-w-xl border-brand">
            <CardBody className="grid gap-4">
              <div>
                <p className="text-heading">{o.reason}</p>
                <p className="text-small text-muted">{o.facility} · {when(o.startsAt)} – {when(o.endsAt, true)}</p>
                <p className="mt-2 text-small font-semibold text-warn">{t('myCallOuts.answerBy', { time: when(o.answerBy, true) })}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button size="lg" loading={busy === `${o.id}ACCEPTED`} icon={<Check className="h-5 w-5" aria-hidden="true" />} onClick={() => answer(o, 'ACCEPTED')}>{t('myCallOuts.yes')}</Button>
                <Button size="lg" variant="secondary" loading={busy === `${o.id}DECLINED`} icon={<X className="h-5 w-5" aria-hidden="true" />} onClick={() => answer(o, 'DECLINED')}>{t('myCallOuts.no')}</Button>
              </div>
              <p className="text-caption text-muted">{t('myCallOuts.fairness')}</p>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
