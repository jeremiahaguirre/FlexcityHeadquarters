'use client';

import { AlertTriangle, Check, Download, LifeBuoy, Minus, Plus, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Field';
import { ListSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api, saveBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { type DeckPool, type ReportRange, csv, rangeBounds } from '@/lib/deck';
import { formatDate, formatTime } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

interface Row { id: string; pool: { id: string; name: string; facility: string; maxCapacity: number | null }; count: number; overCapacity: boolean; lifeguardsRequired: number | null; localRecordedAt: string; by: string | null }

const STORE = 'fh-headcount-v1';
const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* no vibration */
  }
};

/** Tap counter for deck rotations. Each person picks up from the last saved count. */
export default function HeadcountPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'count' | 'report'>('count');
  return (
    <>
      <PageHeader title={t('headcount.title')} description={t('headcount.description')} />
      <div className="mb-5">
        <Segmented
          label={t('ops.section')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'count' as const, label: t('headcount.tabs.count') },
            { value: 'report' as const, label: t('headcount.tabs.report') },
          ]}
        />
      </div>
      {tab === 'count' ? <Clicker /> : <Report />}
    </>
  );
}

function Clicker() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const board = useQuery<DeckPool[]>('/api/ops/headcounts/current');
  const pools = board.data ?? [];
  const [poolId, setPoolId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  // Restore an unsaved count after a reload (shared deck phones), and default to the first pool.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as { poolId?: string; counts?: Record<string, number> };
      if (saved.counts) setCounts(saved.counts);
      if (saved.poolId) setPoolId(saved.poolId);
    } catch {
      /* start fresh */
    }
  }, []);
  useEffect(() => {
    if (!poolId && pools[0]) setPoolId(pools[0].id);
  }, [pools, poolId]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ poolId, counts }));
    } catch {
      /* fine */
    }
  }, [poolId, counts]);

  const pool = pools.find((p) => p.id === poolId) ?? pools[0];
  const count = pool ? (counts[pool.id] ?? pool.last?.count ?? 0) : 0;
  const unsaved = pool ? counts[pool.id] !== undefined && counts[pool.id] !== (pool.last?.count ?? 0) : false;

  const change = useCallback(
    (delta: number) => {
      if (!pool) return;
      buzz();
      setJustSaved(null);
      setCounts((c) => ({ ...c, [pool.id]: Math.max(0, Math.min(9999, (c[pool.id] ?? pool.last?.count ?? 0) + delta)) }));
    },
    [pool],
  );

  // Keyboard on deck tablets: + / − / Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') change(1);
      if (e.key === '-' || e.key === 'ArrowDown') change(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [change]);

  async function save() {
    if (!pool) return;
    setSaving(true);
    try {
      const r = await api<{ overCapacity: boolean; lifeguardsRequired: number | null }>('/api/ops/headcounts', { method: 'POST', body: { poolBodyId: pool.id, count } });
      buzz();
      setJustSaved(pool.id);
      setCounts((c) => {
        const { [pool.id]: _, ...rest } = c;
        return rest;
      });
      toast(r.overCapacity ? t('headcount.savedOver', { count, pool: pool.name }) : t('headcount.saved', { count, pool: pool.name }), r.overCapacity ? 'warn' : 'ok');
      await board.reload();
    } catch {
      toast(t('common.error'), 'warn');
    } finally {
      setSaving(false);
    }
  }

  const pct = pool?.maxCapacity ? count / pool.maxCapacity : null;
  const tone = pct === null ? 'brand' : pct > 1 ? 'danger' : pct >= 0.8 ? 'warn' : 'ok';
  const guards = pool?.bathersPerLifeguard && count > 0 ? Math.max(1, Math.ceil(count / pool.bathersPerLifeguard)) : null;
  const facilities = useMemo(() => new Set(pools.map((p) => p.facility.id)).size, [pools]);

  if (board.loading && !board.data) return <Skeleton className="h-[28rem]" />;
  if (!pools.length) return <EmptyState icon={Users} title={t('headcount.noPools')}>{t('headcount.noPoolsHelp')}</EmptyState>;

  return (
    <div className="mx-auto grid max-w-xl gap-5">
      {/* Pool picker: big targets, wraps on phones */}
      <div role="radiogroup" aria-label={t('ops.pool')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {pools.map((p) => {
          const active = p.id === pool?.id;
          const pending = counts[p.id] !== undefined && counts[p.id] !== (p.last?.count ?? 0);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setPoolId(p.id);
                setJustSaved(null);
              }}
              className={cn(
                'relative min-h-[4rem] rounded-2xl border-2 px-3 py-2 text-left transition-colors',
                active ? 'border-brand bg-brand/10' : 'border-line bg-panel hover:bg-surface',
                p.status !== 'OPEN' && 'opacity-70',
              )}
            >
              <span className="block truncate text-body-strong">{p.name}</span>
              <span className="block truncate text-caption text-muted">
                {facilities > 1 ? `${p.facility.name} · ` : ''}
                {p.status !== 'OPEN' ? t(`status.${p.status}`) : p.last ? t('headcount.lastShort', { count: p.last.count }) : t('headcount.noCountYet')}
              </span>
              {pending ? <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-new" aria-label={t('headcount.unsaved')} /> : null}
            </button>
          );
        })}
      </div>

      {pool ? (
        <Card className="overflow-hidden">
          <div className="grid gap-5 p-5">
            <div className="text-center">
              <p className="text-label uppercase text-muted">{pool.name}</p>
              <p aria-live="polite" className="mt-1 font-display text-[4.5rem] font-extrabold leading-none tabular-nums tracking-tight sm:text-[5.5rem]">
                {count}
              </p>
              <p className="mt-1 text-small text-muted">
                {pool.maxCapacity ? t('headcount.ofCapacity', { max: pool.maxCapacity }) : t('headcount.noCapacity')}
              </p>
            </div>

            {pct !== null ? (
              <div className="grid gap-1.5">
                <div className="h-3 overflow-hidden rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={pool.maxCapacity ?? 0} aria-valuenow={count} aria-label={t('headcount.capacityMeter')}>
                  <div
                    className={cn('h-full rounded-full transition-[width]', tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-ok')}
                    style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
                  />
                </div>
                <div className="flex justify-between text-caption text-muted">
                  <span>{Math.round(pct * 100)}%</span>
                  {guards ? (
                    <span className="flex items-center gap-1 font-semibold text-ink">
                      <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('status.guardsNeeded', { count: guards })}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tone === 'danger' ? (
              <p className="flex items-center gap-2 rounded-xl bg-danger-bg px-4 py-3 text-small font-semibold text-danger">
                <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
                {t('headcount.over', { over: count - (pool.maxCapacity ?? 0) })}
              </p>
            ) : null}

            {/* The clicker: thumb-sized, no precision needed */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => change(-1)}
                disabled={count === 0}
                aria-label={t('headcount.minusOne')}
                className="grid h-24 place-items-center rounded-3xl bg-surface text-ink sm:h-28 active:scale-[0.97] disabled:opacity-40"
              >
                <Minus className="h-12 w-12" strokeWidth={2.5} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => change(1)}
                aria-label={t('headcount.plusOne')}
                className="grid h-24 place-items-center rounded-3xl bg-brand sm:h-28 text-brand-contrast active:scale-[0.97]"
              >
                <Plus className="h-12 w-12" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
            <Button size="lg" block loading={saving} disabled={!unsaved && justSaved === pool.id} icon={<Check className="h-5 w-5" aria-hidden="true" />} onClick={() => void save()}>
              {justSaved === pool.id && !unsaved ? t('headcount.savedShort') : t('headcount.save', { count })}
            </Button>
            {unsaved ? (
              <button type="button" className="justify-self-center text-small font-semibold text-muted underline-offset-2 hover:underline" onClick={() => setCounts(({ [pool.id]: _, ...rest }) => rest)}>
                {t('headcount.reset', { count: pool.last?.count ?? 0 })}
              </button>
            ) : null}
            <div className="grid grid-cols-4 gap-2">
              {[-5, 5, 10, 20].map((d) => (
                <button key={d} type="button" onClick={() => change(d)} className="h-12 rounded-2xl border border-line bg-panel text-body-strong tabular-nums hover:bg-surface active:scale-[0.97]">
                  {d > 0 ? `+${d}` : `−${-d}`}
                </button>
              ))}
            </div>

            <p className="text-center text-caption text-muted">
              {pool.last
                ? t('headcount.lastSaved', { count: pool.last.count, by: pool.last.by ?? '—', time: formatTime(pool.last.localRecordedAt, lng), date: formatDate(pool.last.localRecordedAt, lng) })
                : t('headcount.firstCount')}
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Report() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [range, setRange] = useState<ReportRange>('today');
  const [bounds, setBounds] = useState(() => rangeBounds('today'));
  const [pool, setPool] = useState('');
  const board = useQuery<DeckPool[]>('/api/ops/headcounts/current');
  const rows = useQuery<Row[]>(`/api/ops/headcounts?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}${pool ? `&poolBodyId=${pool}` : ''}`);
  const data = rows.data ?? [];
  const peak = data.reduce<Row | null>((m, r) => (!m || r.count > m.count ? r : m), null);
  const over = data.filter((r) => r.overCapacity).length;
  const download = () =>
    saveBlob(
      csv([['date', 'time', 'facility', 'pool', 'count', 'max_capacity', 'over_capacity', 'lifeguards_required', 'recorded_by'], ...data.map((r) => [r.localRecordedAt.slice(0, 10), r.localRecordedAt.slice(11, 16), r.pool.facility, r.pool.name, r.count, r.pool.maxCapacity, r.overCapacity ? 'yes' : 'no', r.lifeguardsRequired, r.by])]),
      `headcounts-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  return (
    <Card>
      <CardHeader title={t('headcount.reportTitle')} description={t('headcount.reportHelp')} action={<Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} disabled={!data.length} onClick={download}>{t('ops.downloadCsv')}</Button>} />
      <CardBody className="grid gap-4 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t('ops.range')}
            value={range}
            onChange={(r) => {
              setRange(r);
              setBounds(rangeBounds(r));
            }}
            options={[
              { value: 'today' as const, label: t('ops.ranges.today') },
              { value: 'week' as const, label: t('ops.ranges.week') },
              { value: 'month' as const, label: t('ops.ranges.month') },
            ]}
          />
          <div className="w-56">
            <Select aria-label={t('ops.pool')} value={pool} onChange={(e) => setPool(e.target.value)}>
              <option value="">{t('ops.allPools')}</option>
              {board.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="neutral">{t('headcount.countsTaken', { count: data.length })}</StatusPill>
          {peak ? <StatusPill tone="brand">{t('headcount.peak', { count: peak.count, pool: peak.pool.name, time: formatTime(peak.localRecordedAt, lng) })}</StatusPill> : null}
          <StatusPill tone={over ? 'danger' : 'ok'}>{t('headcount.overCount', { count: over })}</StatusPill>
        </div>
        {rows.loading && !rows.data ? (
          <ListSkeleton rows={4} />
        ) : !data.length ? (
          <p className="text-small text-muted">{t('headcount.noCounts')}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-small">
              <thead>
                <tr className="text-left text-label uppercase text-muted">
                  <th className="px-5 py-2 font-semibold">{t('ops.time')}</th>
                  <th className="py-2 font-semibold">{t('ops.pool')}</th>
                  <th className="py-2 text-right font-semibold">{t('headcount.count')}</th>
                  <th className="py-2 text-right font-semibold">{t('headcount.guards')}</th>
                  <th className="px-5 py-2 font-semibold">{t('headcount.by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((r) => (
                  <tr key={r.id} className={r.overCapacity ? 'bg-danger-bg/40' : undefined}>
                    <td className="px-5 py-2.5 tabular-nums">
                      {range === 'today' ? null : <span className="block text-caption text-muted">{formatDate(r.localRecordedAt, lng)}</span>}
                      {formatTime(r.localRecordedAt, lng)}
                    </td>
                    <td className="py-2.5">{r.pool.name}</td>
                    <td className={cn('py-2.5 text-right font-semibold tabular-nums', r.overCapacity && 'text-danger')}>
                      {r.count}
                      {r.pool.maxCapacity ? <span className="font-normal text-muted"> / {r.pool.maxCapacity}</span> : null}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{r.lifeguardsRequired ?? '—'}</td>
                    <td className="px-5 py-2.5 text-muted">{r.by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
