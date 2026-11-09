'use client';

import { BarChart3, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

const METRICS = ['noShowRate', 'lateRate', 'certLapseRate', 'fillHours', 'overtimeShare'] as const;
type Q = { p25: number; p50: number; p75: number; cities: number };
interface Bench { optedIn: boolean; minCities: number; mine: Record<string, number>; peers: Record<string, Q> | null }

/** Lower is better for every measure here. */
function Bar({ mine, q, unit }: { mine: number; q?: Q; unit: string }) {
  const max = Math.max(mine, q?.p75 ?? 0, 1) * 1.25;
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="relative mt-2 h-8" aria-hidden="true">
      <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-surface" />
      {q ? <div className="absolute top-3 h-2 rounded-full bg-brand/30" style={{ left: x(q.p25), width: `calc(${x(q.p75)} - ${x(q.p25)})` }} /> : null}
      {q ? <div className="absolute top-2 h-4 w-0.5 bg-brand" style={{ left: x(q.p50) }} /> : null}
      <div className="absolute top-1 h-6 w-1.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: x(mine) }} />
      <span className="sr-only">{mine}{unit}</span>
    </div>
  );
}

export default function BenchmarksPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const data = useQuery<Bench>('/api/benchmarks');
  const { run, busy } = useAction();
  const d = data.data;
  const unit = (m: string) => (m === 'fillHours' ? ' h' : '%');
  return (
    <div className="grid gap-6">
      <PageHeader title={t('benchmarks.title')} description={t('benchmarks.description')} />
      {!d ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <p className="flex max-w-2xl items-start gap-2 text-small"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />{t('benchmarks.privacy', { n: d.minCities })}</p>
              {can('tenant.configure') ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.optedIn}
                  aria-label={t('benchmarks.share')}
                  disabled={busy === 'opt'}
                  onClick={() => void run('opt', () => api('/api/benchmarks/opt-in', { method: 'PUT', body: { on: !d.optedIn } }), t(d.optedIn ? 'benchmarks.left' : 'benchmarks.joined')).then(() => data.reload())}
                  className="flex items-center gap-3 text-small font-semibold"
                >
                  {t('benchmarks.share')}
                  <span className={`relative h-7 w-12 rounded-full transition-colors ${d.optedIn ? 'bg-brand' : 'bg-line'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${d.optedIn ? 'left-6' : 'left-1'}`} /></span>
                </button>
              ) : null}
            </CardBody>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {METRICS.map((m) => {
              const q = d.peers?.[m];
              return (
                <Card key={m}>
                  <CardHeader title={t(`benchmarks.metric.${m}`)} description={t(`benchmarks.help.${m}`)} />
                  <CardBody className="pt-1">
                    <p className="font-display text-stat tabular-nums">{d.mine[m]}{unit(m)}</p>
                    <Bar mine={d.mine[m] ?? 0} q={q} unit={unit(m)} />
                    <p className="text-caption text-muted">
                      {q ? t('benchmarks.peers', { p50: q.p50, p25: q.p25, p75: q.p75, unit: unit(m), n: q.cities }) : d.optedIn ? t('benchmarks.notEnough', { n: d.minCities }) : t('benchmarks.joinToSee')}
                    </p>
                  </CardBody>
                </Card>
              );
            })}
          </div>
          <p className="flex gap-2 text-caption text-muted"><BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />{t('benchmarks.legend')}</p>
        </>
      )}
    </div>
  );
}
