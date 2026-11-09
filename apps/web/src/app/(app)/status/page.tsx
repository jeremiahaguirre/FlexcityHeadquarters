'use client';

import { BellRing, Droplets, LifeBuoy, Users, Waves } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { POOL_TONE, type PoolView } from '@/lib/pools';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

const BAND = { OPEN: 'bg-ok', CLOSURE_RECOMMENDED: 'bg-warn', CLOSED: 'bg-danger' } as const;

/** Front-desk view: refreshes every 15 seconds; status is text + shape + colour. */
export default function StatusPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const pools = useQuery<PoolView[]>('/api/ops/pools');
  const { run, busy } = useAction();
  const [paging, setPaging] = useState(false);
  const [facilityId, setFacilityId] = useState('');
  const [updated, setUpdated] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => void pools.reload().then(() => setUpdated(new Date())), 15_000);
    return () => clearInterval(id);
  }, [pools]);

  const facilities = [...new Map((pools.data ?? []).map((p) => [p.facility.id, p.facility])).values()];

  return (
    <>
      <PageHeader
        title={t('status.title')}
        description={t('status.updated', { time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(updated) })}
        actions={
          can('ops.page_head_guard') ? (
            <Button icon={<BellRing className="h-5 w-5" aria-hidden="true" />} onClick={() => setPaging(true)}>
              {t('status.page')}
            </Button>
          ) : undefined
        }
      />
      {pools.loading ? (
        <ListSkeleton />
      ) : pools.error ? (
        <ErrorNotice onRetry={pools.reload} />
      ) : !pools.data?.length ? (
        <EmptyState icon={Waves} title={t('status.emptyTitle')}>
          {t('status.emptyBody')}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          {pools.data.map((p) => (
            <li key={p.id}>
              <Card className="relative overflow-hidden p-5">
                <span className={cn('absolute inset-y-0 left-0 w-1.5', BAND[p.status])} aria-hidden="true" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-subheading">{p.name}</h2>
                    <p className="text-small text-muted">{p.facility.name}</p>
                  </div>
                  <StatusPill tone={POOL_TONE[p.status]}>{t(`status.${p.status}`)}</StatusPill>
                </div>
                {p.openClosure ? <p className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-small text-ink">{p.openClosure.reason}</p> : null}
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-surface px-2 py-2">
                    <dt className="flex items-center justify-center gap-1 text-caption text-muted">
                      <Droplets className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('status.chlorine')}
                    </dt>
                    <dd className="text-body-strong tabular-nums">{p.lastReading?.freeChlorinePpm ?? '—'}</dd>
                  </div>
                  <div className="rounded-xl bg-surface px-2 py-2">
                    <dt className="text-caption text-muted">pH</dt>
                    <dd className="text-body-strong tabular-nums">{p.lastReading?.ph ?? '—'}</dd>
                  </div>
                  <div className="rounded-xl bg-surface px-2 py-2">
                    <dt className="flex items-center justify-center gap-1 text-caption text-muted">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('status.bathers')}
                    </dt>
                    <dd className="text-body-strong tabular-nums">{p.lastReading?.batherCount ?? '—'}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
                  <span>{p.lastReading ? t('status.lastReading', { time: formatTime(p.lastReading.localRecordedAt, i18n.language) }) : t('status.noReading')}</span>
                  {p.lifeguardsRequired ? (
                    <span className="flex items-center gap-1 font-semibold text-ink">
                      <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                      {t('status.guardsNeeded', { count: p.lifeguardsRequired })}
                    </span>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={paging} onClose={() => setPaging(false)} title={t('status.page')} description={t('status.pageHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const message = String(new FormData(e.currentTarget).get('message'));
            void run('page', () => api('/api/ops/page-head-guard', { method: 'POST', body: { facilityId: facilityId || facilities[0]?.id, message } }), t('status.paged')).then(() => setPaging(false));
          }}
        >
          {facilities.length > 1 ? (
            <Field label={t('timeclock.facility')}>
              {(p) => (
                <Select {...p} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t('status.message')} hint={t('status.messageHint')}>
            {(p) => <Textarea {...p} name="message" required maxLength={280} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPaging(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={busy === 'page'} icon={<BellRing className="h-4 w-4" aria-hidden="true" />}>
              {t('status.send')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
