'use client';

import { Download, FileSpreadsheet } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Run } from '@/lib/payroll';
import { useAction, useQuery } from '@/lib/useQuery';

type Tab = 'journal' | 'labour' | 'accounts';
interface Line { account: string; key: string; segment: string | null; debit: number; credit: number; description: string }
interface Journal { date: string; period: string; lines: Line[]; totalDebit: number; totalCredit: number; balanced: boolean }
interface Labour { year: number; departments: Array<{ departmentId: string | null; name: string | null; nameFr: string | null; glCode: string | null; months: number[]; wages: number; employerCosts: number; total: number; budget: number | null; used: number | null }>; budgets: Array<{ id: string; name: string; nameFr: string | null; glCode: string | null; labourBudget: number | null }> }

/** Payroll accounting for finance: journal entries, labour cost against budget, and the chart of accounts. */
export default function AccountingPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  // Journal entries and the chart of accounts cover the whole organization; a department-limited lead sees labour cost.
  const tabs: Tab[] = me?.scoped ? ['labour'] : ['journal', 'labour', 'accounts'];
  const [tab, setTab] = useState<Tab>(me?.scoped ? 'labour' : 'journal');
  return (
    <>
      <PageHeader title={t('accounting.title')} description={t('accounting.description')} />
      <div className="mb-6 overflow-x-auto pb-1">
        <Segmented label={t('accounting.title')} value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: t(`accounting.tabs.${x}`) }))} />
      </div>
      {tab === 'journal' ? <Journals /> : tab === 'labour' ? <LabourCost /> : <Accounts />}
    </>
  );
}

function Journals() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const runs = useQuery<Run[]>('/api/payroll/runs');
  const [open, setOpen] = useState<string | null>(null);
  const j = useQuery<Journal>(open ? `/api/accounting/journal/${open}` : null);
  const posted = (runs.data ?? []).filter((r) => r.status === 'APPROVED' || r.status === 'PAID');
  async function csv(id: string) {
    const r = await apiDownload(`/api/accounting/journal/${id}.csv`);
    if (r.ok) saveBlob(r.blob, `journal-${id.slice(0, 8)}.csv`);
    else toast(String(r.error.message ?? t('common.error')), 'warn');
  }
  if (!runs.data) return <Skeleton className="h-64" />;
  if (!posted.length) return <EmptyState icon={FileSpreadsheet} title={t('accounting.noJournals')}>{t('accounting.noJournalsHelp')}</EmptyState>;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('accounting.journals')} description={t('accounting.journalsHelp')} />
        <CardBody className="pt-2">
          <ul className="divide-y divide-line">
            {posted.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <button type="button" className="text-left" onClick={() => setOpen(r.id)}>
                  <span className="block font-semibold hover:underline">{t('accounting.payOn', { date: formatDate(r.payDate, lng, 'dated') })}</span>
                  <span className="text-caption text-muted">{formatDate(r.periodStart, lng)} – {formatDate(r.periodEnd, lng)} · {formatMoney((r.totals.gross ?? 0) + (r.totals.employerCpp ?? 0) + (r.totals.employerEi ?? 0), lng)}</span>
                </button>
                <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void csv(r.id)}>{t('accounting.csv')}</Button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      {open ? (
        <Card>
          <CardHeader title={t('accounting.entry')} description={j.data ? `${j.data.period} · ${j.data.balanced ? t('accounting.balanced') : t('accounting.unbalanced')}` : undefined} />
          <CardBody className="pt-2">
            {!j.data ? <Skeleton className="h-40" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-small tabular-nums">
                  <thead className="text-left text-caption text-muted"><tr><th className="py-1.5 font-semibold">{t('accounting.account')}</th><th className="py-1.5 font-semibold">{t('accounting.segment')}</th><th className="py-1.5 font-semibold">{t('accounting.descriptionCol')}</th><th className="py-1.5 text-right font-semibold">{t('accounting.debit')}</th><th className="py-1.5 text-right font-semibold">{t('accounting.credit')}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {j.data.lines.map((l, i) => (
                      <tr key={i}><td className="py-1.5 font-mono">{l.account}</td><td className="py-1.5 font-mono">{l.segment ?? ''}</td><td className="py-1.5">{l.description}</td><td className="py-1.5 text-right">{l.debit ? formatMoney(l.debit, lng) : ''}</td><td className="py-1.5 text-right">{l.credit ? formatMoney(l.credit, lng) : ''}</td></tr>
                    ))}
                    <tr className="font-semibold"><td className="py-2" colSpan={3}>{t('accounting.totals')}</td><td className="py-2 text-right">{formatMoney(j.data.totalDebit, lng)}</td><td className="py-2 text-right">{formatMoney(j.data.totalCredit, lng)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function LabourCost() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useQuery<Labour>(`/api/accounting/labour-cost?year=${year}`);
  const name = (d: { name: string | null; nameFr: string | null }) => (lng === 'fr-CA' && d.nameFr ? d.nameFr : d.name ?? t('departments.none'));
  return (
    <Card>
      <CardHeader title={t('accounting.labour')} description={t('accounting.labourHelp')} action={<Input aria-label={t('payroll.year')} type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />} />
      <CardBody className="pt-2">
        {!data.data ? <Skeleton className="h-40" /> : !data.data.departments.length ? <p className="text-small text-muted">{t('accounting.noCost')}</p> : (
          <div className="grid gap-4">
            {data.data.departments.map((d) => (
              <div key={d.departmentId ?? 'none'} className="grid gap-2 rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-body-strong">{name(d)}{d.glCode ? <span className="ml-2 font-mono text-caption text-muted">{d.glCode}</span> : null}</p>
                  <p className="text-small tabular-nums">{formatMoney(d.total, lng)}{d.budget ? <span className="text-muted"> / {formatMoney(d.budget, lng)} · {t('accounting.used', { pct: d.used })}</span> : null}</p>
                </div>
                {d.budget ? (
                  <div className="h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={t('accounting.used', { pct: d.used })}>
                    <div className={`h-full rounded-full ${d.used! > 100 ? 'bg-danger' : d.used! > 85 ? 'bg-warn' : 'bg-[rgb(var(--brand))]'}`} style={{ width: `${Math.min(100, d.used!)}%` }} />
                  </div>
                ) : null}
                <p className="text-caption text-muted">{t('accounting.split', { wages: formatMoney(d.wages, lng), employer: formatMoney(d.employerCosts, lng) })}</p>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Accounts() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ accounts: Record<string, string>; keys: string[] }>('/api/accounting/accounts');
  const labour = useQuery<Labour>(`/api/accounting/labour-cost?year=${new Date().getFullYear()}`);
  const { run, busy } = useAction();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // Blank optional accounts keep their defaults instead of failing.
    const body = Object.fromEntries((data.data?.keys ?? []).map((k) => [k, String(f.get(k) ?? '').trim()]).filter(([, v]) => v));
    const r = await run('acc', () => api('/api/accounting/accounts', { method: 'PUT', body }), t('accounting.saved'));
    if (r !== undefined) await data.reload();
  }
  async function saveDept(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const budget = String(f.get('budget') ?? '').trim();
    const r = await run(`d-${id}`, () => api(`/api/accounting/departments/${id}`, { method: 'PUT', body: { glCode: String(f.get('gl') ?? '').trim() || null, labourBudget: budget ? Number(budget) : null } }), t('accounting.saved'));
    if (r !== undefined) await labour.reload();
  }
  if (!data.data) return <Skeleton className="h-64" />;
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader title={t('accounting.chart')} description={t('accounting.chartHelp')} />
        <CardBody className="pt-2">
          <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-2">
            {data.data.keys.map((k) => <Field key={k} label={t(`accounting.keys.${k}`)}>{(p) => <Input {...p} name={k} required defaultValue={data.data!.accounts[k]} className="font-mono" />}</Field>)}
            <div className="sm:col-span-2"><Button type="submit" size="sm" loading={busy === 'acc'}>{t('common.save')}</Button></div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('accounting.deptTitle')} description={t('accounting.deptHelp')} />
        <CardBody className="grid gap-3 pt-2">
          {(labour.data?.budgets ?? []).map((d) => (
            <form key={d.id} onSubmit={(e) => void saveDept(e, d.id)} className="grid items-end gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_9rem_10rem_auto]">
              <p className="font-semibold">{lng === 'fr-CA' && d.nameFr ? d.nameFr : d.name}</p>
              <Field label={t('accounting.glCode')}>{(p) => <Input {...p} name="gl" defaultValue={d.glCode ?? ''} className="font-mono" />}</Field>
              <Field label={t('accounting.budget')}>{(p) => <Input {...p} name="budget" type="number" min={0} step="1" defaultValue={d.labourBudget ?? ''} />}</Field>
              <Button type="submit" size="sm" variant="secondary" loading={busy === `d-${d.id}`}>{t('common.save')}</Button>
            </form>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
