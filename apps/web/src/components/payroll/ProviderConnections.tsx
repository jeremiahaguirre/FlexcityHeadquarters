'use client';

import { CheckCircle2, CloudUpload, Download, Link2, PlugZap, Unplug } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { DEMO } from '@/lib/demo';
import { formatDate } from '@/lib/format';
import { type Issue, issueLabel } from '@/lib/payrollIssues';
import { plusDays, todayIso, useQuery } from '@/lib/useQuery';

type Provider = 'adp' | 'dayforce' | 'wagepoint';
type Mode = 'in_app' | Provider;
interface Sync { id: string; provider: Provider; periodStart: string; periodEnd: string; status: 'SENT' | 'FAILED'; rows: number; reference: string | null; message: string | null; httpStatus: number | null; createdAt: string }
interface View {
  mode: Mode;
  tested: Partial<Record<Provider, string>>;
  adp: { tokenUrl: string; importUrl: string; clientId: string; companyCode: string; batchId: string | null } | null;
  dayforce: { tokenUrl: string; importUrl: string; clientId: string; clientNamespace: string } | null;
  wagepoint: { importUrl: string; companyId: string } | null;
  defaults: { adp: { tokenUrl: string; importUrl: string }; dayforce: { tokenUrl: string; importUrl: string }; wagepoint: { importUrl: string } };
  history: Sync[];
}

/** Before anything is connected (and in the demo, which has no server). */
const NOTHING_CONNECTED: View = {
  mode: 'in_app',
  tested: {},
  adp: null,
  dayforce: null,
  wagepoint: null,
  defaults: { adp: { tokenUrl: 'https://accounts.adp.com/auth/oauth/v2/token', importUrl: 'https://api.adp.com/payroll/v1/payroll-imports' }, dayforce: { tokenUrl: 'https://dfid.dayforcehcm.com/connect/token', importUrl: 'https://www.dayforcehcm.com/api/{namespace}/V1/Imports/PayrollImport' }, wagepoint: { importUrl: 'https://api.wagepoint.com/v1/companies/{company}/hours/import' } },
  history: [],
};

const lastPeriodStart = () => {
  const today = todayIso();
  return plusDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay() - 14);
};

/**
 * How the organization runs payroll: in the app (pay runs here), or with ADP, Dayforce or
 * Wagepoint, which get each period's approved hours straight from FH. One tab each.
 */
export function ProviderConnections({ fileExport }: { fileExport: ReactNode }) {
  const { t } = useTranslation();
  const data = useQuery<View>('/api/payroll/provider');
  const [tab, setTab] = useState<Mode | null>(null);
  const v = data.data ?? (data.error ? NOTHING_CONNECTED : null);
  const current = tab ?? v?.mode ?? 'in_app';
  if (!v) return <Skeleton className="h-96" />;
  return (
    <div className="grid max-w-3xl gap-6">
      <div className="overflow-x-auto pb-1">
        <Segmented label={t('payroll.connect.choose')} value={current} onChange={setTab} options={(['in_app', 'adp', 'dayforce', 'wagepoint'] as const).map((m) => ({ value: m, label: `${t(`payroll.connect.tab.${m}`)}${v.mode === m ? ' ✓' : ''}` }))} />
      </div>
      {current === 'in_app' ? <InApp view={v} reload={data.reload} fileExport={fileExport} /> : <ProviderPanel key={current} provider={current} view={v} reload={data.reload} />}
    </div>
  );
}

function UseButton({ mode, view, reload }: { mode: Mode; view: View; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (view.mode === mode) return <StatusPill tone="ok" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>{t('payroll.connect.inUse')}</StatusPill>;
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      disabled={mode !== 'in_app' && !view[mode]}
      onClick={async () => {
        setBusy(true);
        try {
          await api('/api/payroll/provider/mode', { method: 'PUT', body: { mode } });
          toast(t('payroll.connect.switched', { what: t(`payroll.connect.tab.${mode}`) }), 'ok');
          await reload();
        } catch (e) {
          toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
        } finally {
          setBusy(false);
        }
      }}
    >
      {t(mode === 'in_app' ? 'payroll.connect.useApp' : 'payroll.connect.use', { what: t(`payroll.connect.tab.${mode}`) })}
    </Button>
  );
}

function InApp({ view, reload, fileExport }: { view: View; reload: () => Promise<void>; fileExport: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <Card>
        <CardHeader title={t('payroll.connect.inAppTitle')} description={t('payroll.connect.inAppHelp')} action={<UseButton mode="in_app" view={view} reload={reload} />} />
      </Card>
      <div className="grid gap-2">
        <h2 className="text-subheading">{t('payroll.connect.fileTitle')}</h2>
        <p className="text-small text-muted">{t('payroll.connect.fileHelp')}</p>
      </div>
      {fileExport}
    </>
  );
}

function ProviderPanel({ provider, view, reload }: { provider: Provider; view: View; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const conn = view[provider];
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(!conn);
  const [start, setStart] = useState(lastPeriodStart);
  const [weeks, setWeeks] = useState<'1' | '2'>('2');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const name = t(`payroll.connect.tab.${provider}`);
  const run = async (key: string, fn: () => Promise<void>) => {
    if (DEMO) return toast(t('payroll.connect.demo'), 'warn');
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  };
  async function saveConnection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const opt = (k: string) => v(k) || undefined;
    const body =
      provider === 'adp'
        ? { tokenUrl: v('tokenUrl'), importUrl: v('importUrl'), clientId: v('clientId'), clientSecret: opt('clientSecret'), certificate: opt('certificate'), privateKey: opt('privateKey'), companyCode: v('companyCode'), batchId: v('batchId') || null }
        : provider === 'dayforce'
          ? { tokenUrl: v('tokenUrl'), importUrl: v('importUrl'), clientId: v('clientId'), clientSecret: opt('clientSecret'), clientNamespace: v('clientNamespace') }
          : { importUrl: v('importUrl'), apiKey: opt('apiKey'), companyId: v('companyId') };
    await run('save', async () => {
      await api(`/api/payroll/provider/${provider}`, { method: 'PUT', body });
      toast(t('payroll.connect.saved', { what: name }), 'ok');
      setEditing(false);
      await reload();
    });
  }
  const secretHint = conn ? t('payroll.connect.secretKept') : undefined;
  const d = view.defaults[provider];
  const end = plusDays(start, Number(weeks) * 7 - 1);
  const history = view.history.filter((h) => h.provider === provider);

  return (
    <>
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Link2 className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('payroll.connect.title', { what: name })}</span>}
          description={t(`payroll.connect.help.${provider}`)}
          action={<UseButton mode={provider} view={view} reload={reload} />}
        />
        <CardBody className="grid gap-4 pt-2">
          {conn && !editing ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={view.tested[provider] ? 'ok' : 'warn'}>{view.tested[provider] ? t('payroll.connect.tested', { when: formatDate(view.tested[provider]!, lng, 'dated') }) : t('payroll.connect.untested')}</StatusPill>
              <Button size="sm" variant="secondary" icon={<PlugZap className="h-4 w-4" aria-hidden="true" />} loading={busy === 'test'} onClick={() => void run('test', async () => {
                await api(`/api/payroll/provider/${provider}/test`, { method: 'POST' });
                toast(t('payroll.connect.testOk', { what: name }), 'ok');
                await reload();
              })}>{t('payroll.connect.test')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{t('payroll.connect.edit')}</Button>
              <Button size="sm" variant="ghost" icon={<Unplug className="h-4 w-4" aria-hidden="true" />} loading={busy === 'off'} onClick={() => void run('off', async () => {
                await api(`/api/payroll/provider/${provider}`, { method: 'DELETE' });
                await reload();
              })}>{t('payroll.connect.disconnect')}</Button>
            </div>
          ) : (
            <form onSubmit={(e) => void saveConnection(e)} className="grid gap-4">
              {provider === 'adp' ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('payroll.connect.clientId')}>{(p) => <Input {...p} name="clientId" required defaultValue={view.adp?.clientId ?? ''} autoComplete="off" />}</Field>
                    <Field label={t('payroll.connect.clientSecret')} hint={secretHint}>{(p) => <Input {...p} name="clientSecret" type="password" required={!conn} autoComplete="new-password" />}</Field>
                    <Field label={t('payroll.provider.adpCompanyCode')}>{(p) => <Input {...p} name="companyCode" required maxLength={3} defaultValue={view.adp?.companyCode ?? ''} className="uppercase" />}</Field>
                    <Field label={t('payroll.provider.adpBatchId')}>{(p) => <Input {...p} name="batchId" maxLength={10} defaultValue={view.adp?.batchId ?? ''} />}</Field>
                  </div>
                  <Field label={t('payroll.connect.certificate')} hint={secretHint ?? t('payroll.connect.certificateHint')}>{(p) => <Textarea {...p} name="certificate" rows={3} required={!conn} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-caption" />}</Field>
                  <Field label={t('payroll.connect.privateKey')} hint={secretHint}>{(p) => <Textarea {...p} name="privateKey" rows={3} required={!conn} placeholder={t('payroll.connect.privateKeyPlaceholder')} className="font-mono text-caption" />}</Field>
                </>
              ) : provider === 'dayforce' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('payroll.connect.clientNamespace')} hint={t('payroll.connect.clientNamespaceHint')}>{(p) => <Input {...p} name="clientNamespace" required defaultValue={view.dayforce?.clientNamespace ?? ''} />}</Field>
                  <Field label={t('payroll.connect.clientId')}>{(p) => <Input {...p} name="clientId" required defaultValue={view.dayforce?.clientId ?? ''} autoComplete="off" />}</Field>
                  <Field label={t('payroll.connect.clientSecret')} hint={secretHint}>{(p) => <Input {...p} name="clientSecret" type="password" required={!conn} autoComplete="new-password" />}</Field>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('payroll.connect.companyId')}>{(p) => <Input {...p} name="companyId" required defaultValue={view.wagepoint?.companyId ?? ''} />}</Field>
                  <Field label={t('payroll.connect.apiKey')} hint={secretHint}>{(p) => <Input {...p} name="apiKey" type="password" required={!conn} autoComplete="new-password" />}</Field>
                </div>
              )}
              <details className="rounded-xl border border-line p-3">
                <summary className="cursor-pointer text-small font-semibold">{t('payroll.connect.addresses')}</summary>
                <div className="mt-3 grid gap-3">
                  <p className="text-caption text-muted">{t('payroll.connect.addressesHelp')}</p>
                  {'tokenUrl' in d ? <Field label={t('payroll.connect.tokenUrl')}>{(p) => <Input {...p} name="tokenUrl" type="url" required defaultValue={(conn && 'tokenUrl' in conn ? conn.tokenUrl : d.tokenUrl)} />}</Field> : null}
                  <Field label={t('payroll.connect.importUrl')}>{(p) => <Input {...p} name="importUrl" type="url" required defaultValue={conn?.importUrl ?? d.importUrl} />}</Field>
                </div>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={busy === 'save'}>{t('payroll.connect.save')}</Button>
                {conn ? <Button variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button> : null}
              </div>
              <p className="text-caption text-muted">{t('payroll.connect.sealed')}</p>
            </form>
          )}
        </CardBody>
      </Card>

      {conn ? (
        <Card>
          <CardHeader title={t('payroll.connect.sendTitle', { what: name })} description={t('payroll.connect.sendHelp')} />
          <CardBody className="grid gap-4 pt-2">
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-48"><Field label={t('payroll.start')}>{(p) => <Input {...p} type="date" required value={start} onChange={(e) => setStart(e.target.value)} />}</Field></div>
              <Segmented label={t('payroll.length')} value={weeks} onChange={setWeeks} options={[{ value: '1', label: t('payroll.weeks', { count: 1 }) }, { value: '2', label: t('payroll.weeks', { count: 2 }) }]} />
            </div>
            <p className="text-small text-muted">{t('payroll.covers', { from: formatDate(`${start}T12:00:00`, lng, 'dated'), to: formatDate(`${end}T12:00:00`, lng, 'dated') })}</p>
            <div className="flex flex-wrap gap-2">
              <Button icon={<CloudUpload className="h-5 w-5" aria-hidden="true" />} loading={busy === 'send'} onClick={() => void run('send', async () => {
                setResult(null);
                try {
                  const r = await api<{ rows: number; reference: string | null }>(`/api/payroll/provider/${provider}/send`, { method: 'POST', body: { periodStart: start, weeks: Number(weeks) } });
                  setResult({ ok: true, text: t('payroll.connect.sent', { what: name, count: r.rows, ref: r.reference ?? '—' }) });
                } catch (e) {
                  // Missing details (like the file download): list them, in the reader's language.
                  const problems = e instanceof ApiError ? ((e.details as { problems?: Array<Issue | string> } | undefined)?.problems ?? []) : [];
                  setResult({ ok: false, text: problems.length ? `${e instanceof ApiError ? e.message : ''} ${problems.map((p) => issueLabel(t, p)).join(' · ')}` : e instanceof ApiError ? e.message : t('common.error') });
                }
                await reload();
              })}>{t('payroll.connect.send', { what: name })}</Button>
              <Button variant="secondary" icon={<Download className="h-5 w-5" aria-hidden="true" />} loading={busy === 'file'} onClick={() => void run('file', async () => {
                const r = await apiDownload(`/api/payroll/export?periodStart=${start}&weeks=${weeks}&format=${provider}`);
                if (r.ok) saveBlob(r.blob, `payroll-${provider}-${start}.csv`);
                else toast(String(r.error.message ?? t('common.error')), 'warn');
              })}>{t('payroll.connect.download')}</Button>
            </div>
            {result ? <p role="status" className={`rounded-xl px-3 py-2 text-small ${result.ok ? 'bg-ok-bg text-ok' : 'bg-danger-bg text-danger'}`}>{result.text}</p> : null}
            {history.length ? (
              <div>
                <h3 className="mb-2 text-small font-semibold">{t('payroll.connect.history')}</h3>
                <ul className="divide-y divide-line">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-2 py-2 text-small">
                      <StatusPill tone={h.status === 'SENT' ? 'ok' : 'danger'}>{t(`payroll.connect.status.${h.status}`)}</StatusPill>
                      <span className="font-semibold">{formatDate(`${h.periodStart}T12:00:00`, lng, 'dated')} – {formatDate(`${h.periodEnd}T12:00:00`, lng, 'dated')}</span>
                      <span className="text-muted">{t('payroll.rows', { count: h.rows })}{h.reference ? ` · ${h.reference}` : ''}</span>
                      {h.message ? <span className="w-full text-caption text-danger">{h.message}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
