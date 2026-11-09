'use client';

import { CheckCircle2, FlaskConical, PenLine } from 'lucide-react';
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
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface Reading { id: string; pool: { id: string; name: string }; localRecordedAt: string; freeChlorinePpm: string | null; ph: string | null; batherCount: number | null; outOfRange: boolean; reasons: string[]; recordedBy: string | null; signedOffBy: string | null }

export default function OpsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const lng = i18n.language;
  const pools = useQuery<PoolView[]>(can('ops.status.read') ? '/api/ops/pools' : null);
  const [day] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.toISOString(), to: new Date(d.getTime() + 86_400_000).toISOString() };
  });
  const readings = useQuery<Reading[]>(`/api/ops/readings?from=${encodeURIComponent(day.from)}&to=${encodeURIComponent(day.to)}`);
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
        body: { poolBodyId: v('pool'), freeChlorinePpm: v('fcl'), totalChlorinePpm: v('tcl'), ph: v('ph'), waterTempC: v('temp'), batherCount: v('bathers') ? Number(v('bathers')) : null },
      }),
    );
    if (r) {
      setResult(r);
      e.currentTarget.reset();
      await Promise.all([readings.reload(), pools.reload()]);
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader title={t('ops.record')} description={t('ops.recordHelp')} />
          <CardBody>
            <form onSubmit={(e) => void record(e)} className="grid gap-4">
              <Field label={t('ops.pool')}>
                {(p) => (
                  <Select {...p} name="pool" required>
                    <option value="">{t('common.choose')}</option>
                    {pools.data?.map((x) => (
                      <option key={x.id} value={x.id} disabled={!x.configured}>
                        {x.name} · {x.facility.name}
                        {x.configured ? '' : ` (${t('ops.notConfigured')})`}
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
              <Field label={t('ops.bathers')} hint={t('ops.bathersHint')}>
                {(p) => <Input {...p} inputMode="numeric" pattern="[0-9]*" name="bathers" />}
              </Field>
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
            <CardHeader title={t('ops.today')} />
            <CardBody className="pt-3">
              {readings.loading ? (
                <Skeleton className="h-32" />
              ) : !readings.data?.length ? (
                <p className="text-small text-muted">{t('ops.noReadings')}</p>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-small">
                    <thead>
                      <tr className="text-left text-label uppercase text-muted">
                        <th className="px-5 py-2 font-semibold">{t('ops.time')}</th>
                        <th className="py-2 font-semibold">{t('ops.pool')}</th>
                        <th className="py-2 text-right font-semibold">{t('status.chlorine')}</th>
                        <th className="py-2 text-right font-semibold">pH</th>
                        <th className="py-2 text-right font-semibold">{t('status.bathers')}</th>
                        <th className="px-5 py-2 text-right font-semibold">{t('ops.check')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {readings.data.map((r) => (
                        <tr key={r.id}>
                          <td className="px-5 py-2.5 tabular-nums">{formatTime(r.localRecordedAt, lng)}</td>
                          <td className="py-2.5">
                            {r.pool.name}
                            <span className="block text-caption text-muted">{r.recordedBy}</span>
                          </td>
                          <td className={`py-2.5 text-right tabular-nums ${r.outOfRange ? 'font-semibold text-warn' : ''}`}>{r.freeChlorinePpm ?? '—'}</td>
                          <td className="py-2.5 text-right tabular-nums">{r.ph ?? '—'}</td>
                          <td className="py-2.5 text-right tabular-nums">{r.batherCount ?? '—'}</td>
                          <td className="px-5 py-2.5 text-right">
                            {r.signedOffBy ? (
                              <StatusPill tone="ok">{r.signedOffBy}</StatusPill>
                            ) : can('ops.chemical.signoff') ? (
                              <Button size="sm" variant="secondary" icon={<PenLine className="h-4 w-4" aria-hidden="true" />} loading={busy === `sign-${r.id}`} onClick={() => void run(`sign-${r.id}`, () => api(`/api/ops/readings/${r.id}/signoff`, { method: 'POST' }), t('ops.signed')).then(() => readings.reload())}>
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
        </div>
      </div>
    </>
  );
}
