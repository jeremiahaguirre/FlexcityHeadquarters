'use client';

import { CheckCircle2, Download, FlaskConical, PenLine } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { POOL_TONE, type PoolView } from '@/lib/pools';
import { type DeckPool, type ReportRange, csv, rangeBounds } from '@/lib/deck';
import { Segmented } from '@/components/ui/Segmented';
import { saveBlob } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface Reading { id: string; pool: { id: string; name: string }; localRecordedAt: string; freeChlorinePpm: string | null; totalChlorinePpm: string | null; ph: string | null; waterTempC: string | null; outOfRange: boolean; reasons: string[]; recordedBy: string | null; signedOffBy: string | null }

/** Water chemistry: record pool tests. An out-of-range reading recommends a closure that a head guard must confirm. */
export default function OpsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const lng = i18n.language;
  // Leads see closure decisions; everyone on deck picks from the deck's own pool list.
  const pools = useQuery<PoolView[]>(can('ops.status.read') ? '/api/ops/pools' : null);
  const deckPools = useQuery<DeckPool[]>('/api/ops/headcounts/current');
  const [tab, setTab] = useState<'record' | 'report'>('record');
  const [range, setRange] = useState<ReportRange>('today');
  const [poolFilter, setPoolFilter] = useState('');
  const [bounds, setBounds] = useState(() => rangeBounds('today'));
  const readings = useQuery<Reading[]>(`/api/ops/readings?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}${poolFilter ? `&poolBodyId=${poolFilter}` : ''}`);
  const pickRange = (r: ReportRange) => {
    setRange(r);
    setBounds(rangeBounds(r));
  };
  const { run, busy } = useAction();
  const [result, setResult] = useState<{ outOfRange: boolean; reasons: string[] } | null>(null);
  const [dismissFor, setDismissFor] = useState<string | null>(null);

  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => (String(f.get(k) ?? '').trim() || null);
    const r = await run('record', () =>
      api<{ outOfRange: boolean; reasons: string[] }>('/api/ops/readings', {
        method: 'POST',
        body: { poolBodyId: v('pool'), freeChlorinePpm: v('fcl'), totalChlorinePpm: v('tcl'), ph: v('ph'), waterTempC: v('temp') },
      }),
    );
    if (r) {
      setResult(r);
      e.currentTarget.reset();
      await Promise.all([readings.reload(), pools.reload(), deckPools.reload()]);
    }
  }

  const decide = (poolId: string, action: 'CONFIRM' | 'DISMISS' | 'REOPEN', note?: string) =>
    run(`${action}-${poolId}`, () => api(`/api/ops/pools/${poolId}/closure`, { method: 'POST', body: { action, note } }), t(`ops.done.${action}`)).then(() => {
      setDismissFor(null);
      return pools.reload();
    });

  const needsDecision = pools.data?.filter((p) => p.status !== 'OPEN') ?? [];
  const decimal = { inputMode: 'decimal' as const, pattern: '[0-9]*[.,]?[0-9]*' };

  return (
    <>
      <PageHeader title={t('ops.title')} description={t('ops.description')} />
      <div className="mb-6">
        <Segmented
          label={t('ops.section')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'record' as const, label: t('ops.tabs.record') },
            { value: 'report' as const, label: t('ops.tabs.report') },
          ]}
        />
      </div>
      {tab === 'report' ? (
        <ChemistryReport
          readings={readings.data}
          loading={readings.loading}
          pools={deckPools.data ?? []}
          range={range}
          onRange={pickRange}
          pool={poolFilter}
          onPool={setPoolFilter}
          signOff={can('ops.chemical.signoff') ? (id) => run(`sign-${id}`, () => api(`/api/ops/readings/${id}/signoff`, { method: 'POST' }), t('ops.signed')).then(() => readings.reload()) : null}
          busy={busy}
        />
      ) : (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader title={t('ops.record')} description={t('ops.recordHelp')} />
          <CardBody>
            <form onSubmit={(e) => void record(e)} className="grid gap-4">
              <Field label={t('ops.pool')}>
                {(p) => (
                  <Select {...p} name="pool" required>
                    <option value="">{t('common.choose')}</option>
                    {deckPools.data?.map((x) => (
                      <option key={x.id} value={x.id} disabled={!x.limitsSet}>
                        {x.name} · {x.facility.name}
                        {x.limitsSet ? '' : ` (${t('ops.notConfigured')})`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('ops.freeChlorine')}>{(p) => <Input {...p} {...decimal} name="fcl" placeholder="2.0" />}</Field>
                <Field label={t('ops.totalChlorine')}>{(p) => <Input {...p} {...decimal} name="tcl" placeholder="2.2" />}</Field>
                <Field label="pH">{(p) => <Input {...p} {...decimal} name="ph" placeholder="7.4" />}</Field>
                <Field label={t('ops.temp')}>{(p) => <Input {...p} {...decimal} name="temp" placeholder="27.5" />}</Field>
              </div>
              <Button type="submit" size="lg" block loading={busy === 'record'} icon={<FlaskConical className="h-5 w-5" aria-hidden="true" />}>
                {t('ops.save')}
              </Button>
              <div aria-live="polite">
                {result ? (
                  result.outOfRange ? (
                    <div className="rounded-xl bg-warn-bg px-4 py-3 text-small text-ink">
                      <p className="font-semibold text-warn">{t('ops.outOfRange')}</p>
                      <ul className="mt-1 list-disc pl-5">
                        {result.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 rounded-xl bg-ok-bg px-4 py-3 text-small font-semibold text-ok">
                      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      {t('ops.inRange')}
                    </p>
                  )
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="grid content-start gap-6">
          {can('ops.pool.close') && needsDecision.length ? (
            <section aria-labelledby="decide-h" className="grid gap-3">
              <h2 id="decide-h" className="text-heading">
                {t('ops.decide')}
              </h2>
              {needsDecision.map((p) => (
                <Card key={p.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-subheading">{p.name}</p>
                      <p className="text-small text-muted">{p.openClosure?.reason}</p>
                    </div>
                    <StatusPill tone={POOL_TONE[p.status]}>{t(`status.${p.status}`)}</StatusPill>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {p.status === 'CLOSURE_RECOMMENDED' ? (
                      <>
                        <Button variant="secondary" onClick={() => setDismissFor(p.id)}>
                          {t('ops.dismiss')}
                        </Button>
                        <Button variant="danger" loading={busy === `CONFIRM-${p.id}`} onClick={() => void decide(p.id, 'CONFIRM')}>
                          {t('ops.confirm')}
                        </Button>
                      </>
                    ) : (
                      <Button loading={busy === `REOPEN-${p.id}`} onClick={() => void decide(p.id, 'REOPEN')}>
                        {t('ops.reopen')}
                      </Button>
                    )}
                  </div>
                  {dismissFor === p.id ? (
                    <form
                      className="mt-4 grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void decide(p.id, 'DISMISS', String(new FormData(e.currentTarget).get('note')));
                      }}
                    >
                      <Field label={t('ops.dismissNote')}>{(f) => <Textarea {...f} name="note" required placeholder={t('ops.dismissPlaceholder')} />}</Field>
                      <Button type="submit" loading={busy === `DISMISS-${p.id}`}>
                        {t('ops.dismissConfirm')}
                      </Button>
                    </form>
                  ) : null}
                </Card>
              ))}
            </section>
          ) : null}

          <Card>
            <CardHeader title={t('ops.today')} action={<Button size="sm" variant="ghost" onClick={() => setTab('report')}>{t('ops.fullReport')}</Button>} />
            <CardBody className="pt-3">
              {range !== 'today' || poolFilter ? (
                <p className="text-small text-muted">{t('ops.seeReport')}</p>
              ) : !readings.data?.length ? (
                <p className="text-small text-muted">{t('ops.noReadings')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {readings.data.slice(0, 6).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-small">
                      <span>
                        <span className="font-semibold tabular-nums">{formatTime(r.localRecordedAt, lng)}</span> · {r.pool.name}
                      </span>
                      <span className={`tabular-nums ${r.outOfRange ? 'font-semibold text-warn' : 'text-muted'}`}>
                        FCl {r.freeChlorinePpm ?? '—'} · pH {r.ph ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      )}
    </>
  );
}

function ChemistryReport({
  readings,
  loading,
  pools,
  range,
  onRange,
  pool,
  onPool,
  signOff,
  busy,
}: {
  readings: Reading[] | null;
  loading: boolean;
  pools: DeckPool[];
  range: ReportRange;
  onRange: (r: ReportRange) => void;
  pool: string;
  onPool: (id: string) => void;
  signOff: ((id: string) => Promise<unknown>) | null;
  busy: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const rows = readings ?? [];
  const outOfRange = rows.filter((r) => r.outOfRange).length;
  const unsigned = rows.filter((r) => !r.signedOffBy).length;
  const download = () =>
    saveBlob(
      csv([
        ['date', 'time', 'pool', 'free_chlorine_ppm', 'total_chlorine_ppm', 'ph', 'water_temp_c', 'in_range', 'issues', 'recorded_by', 'signed_off_by'],
        ...rows.map((r) => [r.localRecordedAt.slice(0, 10), r.localRecordedAt.slice(11, 16), r.pool.name, r.freeChlorinePpm, r.totalChlorinePpm, r.ph, r.waterTempC, r.outOfRange ? 'no' : 'yes', r.reasons.join('; '), r.recordedBy, r.signedOffBy]),
      ]),
      `water-chemistry-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  return (
    <Card>
      <CardHeader title={t('ops.reportTitle')} description={t('ops.reportHelp')} action={<Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} disabled={!rows.length} onClick={download}>{t('ops.downloadCsv')}</Button>} />
      <CardBody className="grid gap-4 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t('ops.range')}
            value={range}
            onChange={onRange}
            options={[
              { value: 'today' as const, label: t('ops.ranges.today') },
              { value: 'week' as const, label: t('ops.ranges.week') },
              { value: 'month' as const, label: t('ops.ranges.month') },
            ]}
          />
          <div className="w-56">
            <Select aria-label={t('ops.pool')} value={pool} onChange={(e) => onPool(e.target.value)}>
              <option value="">{t('ops.allPools')}</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="neutral">{t('ops.readingsCount', { count: rows.length })}</StatusPill>
          <StatusPill tone={outOfRange ? 'warn' : 'ok'}>{t('ops.outOfRangeCount', { count: outOfRange })}</StatusPill>
          <StatusPill tone={unsigned ? 'new' : 'ok'}>{t('ops.unsignedCount', { count: unsigned })}</StatusPill>
        </div>
        {loading && !readings ? (
          <Skeleton className="h-32" />
        ) : !rows.length ? (
          <p className="text-small text-muted">{t('ops.noReadingsRange')}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-small">
              <thead>
                <tr className="text-left text-caption font-semibold text-muted">
                  <th className="px-5 py-2 font-semibold">{t('ops.time')}</th>
                  <th className="py-2 font-semibold">{t('ops.pool')}</th>
                  <th className="py-2 text-right font-semibold">{t('ops.fclShort')}</th>
                  <th className="py-2 text-right font-semibold">{t('ops.tclShort')}</th>
                  <th className="py-2 text-right font-semibold">pH</th>
                  <th className="py-2 text-right font-semibold">°C</th>
                  <th className="px-5 py-2 text-right font-semibold">{t('ops.check')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={r.outOfRange ? 'bg-warn-bg/40' : undefined}>
                    <td className="px-5 py-2.5 tabular-nums">
                      {range === 'today' ? null : <span className="block text-caption text-muted">{formatDate(r.localRecordedAt, lng)}</span>}
                      {formatTime(r.localRecordedAt, lng)}
                    </td>
                    <td className="py-2.5">
                      {r.pool.name}
                      <span className="block text-caption text-muted">{r.recordedBy}</span>
                      {r.outOfRange && r.reasons.length ? <span className="block text-caption text-warn">{r.reasons.join(' · ')}</span> : null}
                    </td>
                    <td className={`py-2.5 text-right tabular-nums ${r.outOfRange ? 'font-semibold text-warn' : ''}`}>{r.freeChlorinePpm ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.totalChlorinePpm ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.ph ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.waterTempC ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      {r.signedOffBy ? (
                        <StatusPill tone="ok">{r.signedOffBy}</StatusPill>
                      ) : signOff ? (
                        <Button size="sm" variant="secondary" icon={<PenLine className="h-4 w-4" aria-hidden="true" />} loading={busy === `sign-${r.id}`} onClick={() => void signOff(r.id)}>
                          {t('ops.signOff')}
                        </Button>
                      ) : (
                        <StatusPill tone="neutral">{t('ops.unsigned')}</StatusPill>
                      )}
                    </td>
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
