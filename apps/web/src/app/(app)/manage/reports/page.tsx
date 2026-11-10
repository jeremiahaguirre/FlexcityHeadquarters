'use client';

import { BarChart3, Download, Play, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney } from '@/lib/format';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';

interface Def { key: string; kind: 'range' | 'ahead' }
interface Result { from: string; to: string; columns: string[]; rows: Array<Record<string, string | number | null>> }
interface Saved { id: string; name: string; key: string; params: { days?: number }; schedule: 'NONE' | 'WEEKLY' | 'MONTHLY' }

/** Built-in reports: run for a period, download as a spreadsheet, save, have them emailed. */
export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const defs = useQuery<Def[]>('/api/reports');
  const saved = useQuery<Saved[]>('/api/reports/saved');
  const { run, busy } = useAction();
  const [key, setKey] = useState<string>('');
  const [from, setFrom] = useState(plusDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [days, setDays] = useState(60);
  const [result, setResult] = useState<Result | null>(null);
  const current = defs.data?.find((d) => d.key === (key || defs.data?.[0]?.key));
  const k = current?.key ?? '';
  const qs = (x = k) => `key=${x}&from=${from}&to=${to}&days=${days}`;
  const label = (c: string) => t(`reports.columns.${c}`, { defaultValue: c });
  const MONEY = new Set(['gross', 'employerCosts', 'total']);
  const cell = (c: string, v: string | number | null) => (v === null || v === '' ? '—' : typeof v === 'number' ? (MONEY.has(c) ? formatMoney(v, lng) : v.toLocaleString(lng)) : c === 'type' ? t(`timeOff.types.${v}`, { defaultValue: v }) : c === 'category' ? t(`incidents.categories.${v}`, { defaultValue: v }) : v);
  const go = (x = k) => run('run', () => api<Result>(`/api/reports/run?${qs(x)}`)).then((r) => r && setResult(r));
  async function csv() {
    const labels = encodeURIComponent(JSON.stringify(Object.fromEntries((result?.columns ?? []).map((c) => [c, label(c)]))));
    const r = await apiDownload(`/api/reports/run.csv?${qs()}&labels=${labels}`);
    if (r.ok) saveBlob(r.blob, `${t(`reports.names.${k}`)} ${from}–${to}.csv`);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('save', () => api('/api/reports/saved', { method: 'POST', body: { name: String(f.get('name')), key: k, schedule: String(f.get('schedule')), ...(current?.kind === 'ahead' ? { days } : {}) } }), t('reports.saved'));
    if (r !== undefined) await saved.reload();
  }

  if (defs.loading) return <Skeleton className="h-64" />;
  if (!defs.data?.length) return <><PageHeader title={t('reports.title')} /><EmptyState icon={BarChart3} title={t('reports.noneTitle')}>{t('reports.noneBody')}</EmptyState></>;
  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.help')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardBody className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-3"><Field label={t('reports.report')} hint={t(`reports.about.${k}`)}>{(p) => <Select {...p} value={k} onChange={(e) => { setKey(e.target.value); setResult(null); }}>{defs.data!.map((d) => <option key={d.key} value={d.key}>{t(`reports.names.${d.key}`)}</option>)}</Select>}</Field></div>
                {current?.kind === 'ahead' ? (
                  <Field label={t('reports.daysAhead')}>{(p) => <Input {...p} type="number" min={1} max={366} value={days} onChange={(e) => setDays(Number(e.target.value))} />}</Field>
                ) : (
                  <>
                    <Field label={t('reports.from')}>{(p) => <Input {...p} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
                    <Field label={t('reports.to')}>{(p) => <Input {...p} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Play className="h-4 w-4" aria-hidden="true" />} loading={busy === 'run'} onClick={() => void go()}>{t('reports.run')}</Button>
                {result ? <Button variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void csv()}>{t('reports.csv')}</Button> : null}
              </div>
            </CardBody>
          </Card>
          {result ? (
            <Card>
              <CardHeader title={t(`reports.names.${k}`)} description={t('reports.rows', { count: result.rows.length })} />
              <CardBody className="pt-2">
                {!result.rows.length ? <p className="text-small text-muted">{t('reports.empty')}</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-small">
                      <thead className="text-caption uppercase text-muted"><tr>{result.columns.map((c) => <th key={c} className={`py-2 pr-3 font-semibold ${typeof result.rows[0]?.[c] === 'number' ? 'text-right' : 'text-left'}`}>{label(c)}</th>)}</tr></thead>
                      <tbody className="divide-y divide-line">{result.rows.map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c} className={`py-2 pr-3 ${typeof r[c] === 'number' ? 'text-right tabular-nums' : ''}`}>{cell(c, r[c] ?? null)}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title={t('reports.saveTitle')} description={t('reports.saveHelp')} />
            <CardBody className="pt-2">
              <form onSubmit={(e) => void save(e)} className="grid gap-3">
                <Field label={t('reports.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} defaultValue={t(`reports.names.${k}`)} key={k} />}</Field>
                <Field label={t('reports.email')}>{(p) => <Select {...p} name="schedule" defaultValue="WEEKLY">{(['NONE', 'WEEKLY', 'MONTHLY'] as const).map((s) => <option key={s} value={s}>{t(`reports.schedules.${s}`)}</option>)}</Select>}</Field>
                <Button type="submit" variant="secondary" className="justify-self-start" loading={busy === 'save'} icon={<Save className="h-4 w-4" aria-hidden="true" />}>{t('reports.save')}</Button>
              </form>
            </CardBody>
          </Card>
          {saved.data?.length ? (
            <Card>
              <CardHeader title={t('reports.mine')} />
              <CardBody className="grid gap-2 pt-2">
                {saved.data.map((s) => (
                  <div key={s.id} className="grid gap-2 rounded-xl border border-line p-3 text-small">
                    <button type="button" className="text-left font-semibold text-brand-text hover:underline" onClick={() => { setKey(s.key); if (s.params.days) setDays(s.params.days); void go(s.key); }}>{s.name}</button>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select aria-label={t('reports.email')} value={s.schedule} className="w-40" onChange={(e) => void run(s.id, () => api(`/api/reports/saved/${s.id}`, { method: 'PATCH', body: { schedule: e.target.value } })).then(() => saved.reload())}>{(['NONE', 'WEEKLY', 'MONTHLY'] as const).map((x) => <option key={x} value={x}>{t(`reports.schedules.${x}`)}</option>)}</Select>
                      <Button size="sm" variant="ghost" aria-label={t('reports.remove', { name: s.name })} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(s.id, () => api(`/api/reports/saved/${s.id}`, { method: 'DELETE' })).then(() => saved.reload())} />
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
