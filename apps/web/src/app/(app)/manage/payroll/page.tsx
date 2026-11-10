'use client';

import { AlertTriangle, CheckCircle2, Download, Settings, Users } from 'lucide-react';
import { type FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayDocuments } from '@/components/payroll/PayDocuments';
import { PayPeople } from '@/components/payroll/PayPeople';
import { PayRuns } from '@/components/payroll/PayRuns';
import { PaySettings } from '@/components/payroll/PaySettings';
import { useTranslation } from 'react-i18next';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toast';
import { apiDownload, saveBlob } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { plusDays, todayIso } from '@/lib/useQuery';

type Result =
  | { kind: 'done'; file: string; rows: number; warnings: string[] }
  | { kind: 'problems'; problems: string[]; warnings: string[] };

/** The Sunday two weeks before the most recent Sunday: the last full two-week period. */
function lastPeriodStart(): string {
  const today = todayIso();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return plusDays(today, -dow - 14);
}

/** The CSV for an outside payroll provider (cities that keep using one). */
function ProviderExport() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const [start, setStart] = useState(lastPeriodStart);
  const [weeks, setWeeks] = useState<'1' | '2'>('2');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const end = start ? plusDays(start, Number(weeks) * 7 - 1) : '';

  async function build(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await apiDownload(`/api/payroll/export?periodStart=${start}&weeks=${weeks}`);
      if (r.ok) {
        const header = r.headers.get('X-Flexcity-Warnings');
        const warnings = header ? decodeURIComponent(header).split(' | ') : [];
        const text = await r.blob.text();
        const file = `payroll-${start}.csv`;
        saveBlob(r.blob, file);
        setResult({ kind: 'done', file, rows: Math.max(0, text.trim().split(/\r?\n/).length - 1), warnings });
      } else if (r.error.code === 'EXPORT_INVALID') {
        setResult({ kind: 'problems', problems: (r.error.problems as string[]) ?? [], warnings: (r.error.warnings as string[]) ?? [] });
      } else {
        toast(t(`errors.${String(r.error.code)}`, { defaultValue: String(r.error.message ?? t('common.error')) }), 'warn');
      }
    } catch {
      toast(t('common.error'), 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader title={t('payroll.period')} description={t('payroll.periodHelp')} />
          <CardBody className="pt-3">
            <form onSubmit={(e) => void build(e)} className="grid gap-5">
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-48">
                  <Field label={t('payroll.start')}>{(p) => <Input {...p} type="date" required value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
                </div>
                <Segmented
                  label={t('payroll.length')}
                  value={weeks}
                  onChange={setWeeks}
                  options={[
                    { value: '1', label: t('payroll.weeks', { count: 1 }) },
                    { value: '2', label: t('payroll.weeks', { count: 2 }) },
                  ]}
                />
              </div>
              {start ? (
                <p className="text-body text-muted">
                  {t('payroll.covers', { from: formatDate(`${start}T12:00:00`, lng, 'dated'), to: formatDate(`${end}T12:00:00`, lng, 'dated') })}
                </p>
              ) : null}
              <Button type="submit" className="justify-self-start" loading={busy} icon={<Download className="h-5 w-5" aria-hidden="true" />}>
                {t('payroll.build')}
              </Button>
            </form>
          </CardBody>
        </Card>

        {result?.kind === 'done' ? (
          <Card className="border-ok/30">
            <CardBody className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-ok" aria-hidden="true" />
              <div className="grid gap-1">
                <p className="text-body-strong">{t('payroll.downloaded', { file: result.file })}</p>
                <p className="text-small text-muted">{result.rows ? t('payroll.rows', { count: result.rows }) : t('payroll.empty')}</p>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {result?.kind === 'problems' ? (
          <Card className="border-danger/30">
            <CardHeader title={t('payroll.fixFirst')} description={t('payroll.fixFirstHelp')} />
            <CardBody className="grid gap-4 pt-3">
              <ul className="grid gap-2">
                {result.problems.map((p) => (
                  <li key={p} className="flex gap-2 text-small">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/manage/staff" variant="secondary" size="sm" icon={<Users className="h-4 w-4" aria-hidden="true" />}>
                  {t('payroll.openStaff')}
                </ButtonLink>
                <ButtonLink href="/manage/settings" variant="secondary" size="sm" icon={<Settings className="h-4 w-4" aria-hidden="true" />}>
                  {t('payroll.openSettings')}
                </ButtonLink>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {result?.warnings.length ? (
          <Card>
            <CardHeader title={t('payroll.warnings')} description={t('payroll.warningsHelp')} />
            <CardBody className="pt-3">
              <ul className="grid list-disc gap-1.5 pl-5 text-small">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}

type Tab = 'runs' | 'people' | 'documents' | 'settings' | 'export';

export default function PayrollPage() {
  return (
    <Suspense fallback={null}>
      <PayrollTabs />
    </Suspense>
  );
}

/** Pay runs, people (tax set-up and direct deposit), documents, settings and the provider export. */
function PayrollTabs() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const tabs: Tab[] = ['runs', 'people', 'documents', 'settings', 'export'];
  const [tab, setTab] = useState<Tab>(() => (tabs.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'runs'));
  return (
    <>
      <PageHeader title={t('payroll.title')} description={t('payroll.descriptionFull')} />
      <div className="mb-6 overflow-x-auto pb-1">
        <Segmented label={t('payroll.title')} value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: t(`payroll.tabs.${x}`) }))} />
      </div>
      {tab === 'runs' ? <PayRuns /> : null}
      {tab === 'people' ? <PayPeople /> : null}
      {tab === 'documents' ? <PayDocuments /> : null}
      {tab === 'settings' ? <PaySettings /> : null}
      {tab === 'export' ? <ProviderExport /> : null}
    </>
  );
}
