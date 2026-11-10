'use client';

import { Banknote, CheckCircle2, PlugZap, Unplug } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { papi, usePlatformQuery } from '@/lib/platform';

interface Deposit { businessNumber: string | null; originatorId: string | null; originatorShortName: string | null; originatorLongName: string | null; destinationDataCentre: string | null; returnsInstitution: string | null; returnsTransit: string | null; returnsAccount: string | null }
interface Bank { configured: boolean; host?: string; port?: number; username?: string; remoteDir?: string; hostKeySha256?: string; autoSend?: boolean; pgpFingerprint?: string | null }
interface View { mode: string; deposit: Deposit; bank: Bank; readiness: { ready: boolean; missing: string[]; bankConnected: boolean; autoSend: boolean }; staffWithDeposit: number; bankConnectionInPlan: boolean }

/**
 * Set up a city's in-app payroll for them: pay goes from the city's own bank account straight to
 * its staff by direct deposit (CPA-005), with no payroll provider.
 */
export function PayrollSetupPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const data = usePlatformQuery<View>(`/tenants/${id}/payroll`);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      await data.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  };
  if (data.error) return <ErrorNotice onRetry={data.reload} />;
  if (!data.data) return <Skeleton className="h-96" />;
  const v = data.data;
  const d = v.deposit;

  function saveDeposit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const account = s('returnsAccount');
    void run('deposit', () => papi(`/tenants/${id}/payroll`, { method: 'PUT', body: { inApp: true, businessNumber: s('businessNumber'), originatorId: s('originatorId'), originatorShortName: s('originatorShortName'), originatorLongName: s('originatorLongName'), destinationDataCentre: s('destinationDataCentre'), returnsInstitution: s('returnsInstitution'), returnsTransit: s('returnsTransit'), ...(account ? { returnsAccount: account } : {}) } }), t('payrollSetup.saved'));
  }
  function saveBank(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const secret = s('secret');
    void run('bank', () => papi(`/tenants/${id}/payroll/bank`, { method: 'PUT', body: { host: s('host'), port: Number(s('port') || 22), username: s('username'), remoteDir: s('remoteDir'), hostKeySha256: s('hostKeySha256'), pgpPublicKey: s('pgpPublicKey') || null, autoSend: f.get('autoSend') === 'on', ...(secret ? (secret.includes('PRIVATE KEY') ? { privateKey: secret } : { password: secret }) : {}) } }), t('payrollSetup.bankSaved'));
  }
  const field = (name: keyof Deposit, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}>{(p) => <Input {...p} name={name} defaultValue={name === 'returnsAccount' ? '' : (d[name] ?? '')} placeholder={name === 'returnsAccount' && d.returnsAccount ? d.returnsAccount : undefined} {...props} />}</Field>
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Banknote className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('payrollSetup.title')}</span>}
          description={t('payrollSetup.lead')}
          action={v.mode === 'in_app' ? <StatusPill tone="ok" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>{t('payrollSetup.inApp')}</StatusPill> : <StatusPill tone="warn">{t('payrollSetup.provider', { name: v.mode })}</StatusPill>}
        />
        <CardBody className="grid gap-2 pt-0">
          <ol className="grid gap-2 sm:grid-cols-3">
            {[
              [t('payrollSetup.step.deposit'), !v.readiness.missing.length],
              [t('payrollSetup.step.bank'), v.readiness.bankConnected],
              [t('payrollSetup.step.staff', { count: v.staffWithDeposit }), v.staffWithDeposit > 0],
            ].map(([label, done], i) => (
              <li key={i} className={`flex items-center gap-2 rounded-xl border p-3 text-small ${done ? 'border-ok/30 bg-ok-bg' : 'border-line'}`}>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-caption font-bold ${done ? 'bg-ok text-white' : 'bg-surface text-muted'}`}>{done ? '✓' : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <p className="text-caption text-muted">{v.readiness.bankConnected ? (v.readiness.autoSend ? t('payrollSetup.flowAuto') : t('payrollSetup.flowManual')) : t('payrollSetup.flowFile')}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('payrollSetup.depositTitle')} description={t('payrollSetup.depositHelp')} />
        <CardBody className="pt-2">
          <form onSubmit={saveDeposit} className="grid gap-4 sm:grid-cols-2">
            {field('businessNumber', t('payroll.businessNumber'), { placeholder: '123456789RP0001' })}
            {field('originatorId', t('payroll.originatorId'), { maxLength: 10 })}
            {field('originatorShortName', t('payroll.shortName'), { maxLength: 15 })}
            {field('originatorLongName', t('payroll.longName'), { maxLength: 30 })}
            {field('destinationDataCentre', t('payroll.dataCentre'), { inputMode: 'numeric', maxLength: 5 })}
            {field('returnsInstitution', t('payroll.returnsInstitution'), { inputMode: 'numeric', maxLength: 3 })}
            {field('returnsTransit', t('payroll.returnsTransit'), { inputMode: 'numeric', maxLength: 5 })}
            {field('returnsAccount', t('payroll.returnsAccount'), { inputMode: 'numeric', maxLength: 12, autoComplete: 'off' })}
            <div className="sm:col-span-2"><Button type="submit" loading={busy === 'deposit'}>{t('payrollSetup.saveDeposit')}</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('payrollSetup.bankTitle')}
          description={v.bankConnectionInPlan ? t('payrollSetup.bankHelp') : t('payrollSetup.bankNotInPlan')}
          action={v.bank.configured ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<PlugZap className="h-4 w-4" aria-hidden="true" />} loading={busy === 'test'} onClick={() => void run('test', () => papi(`/tenants/${id}/payroll/bank/test`, { method: 'POST' }), t('payrollSetup.bankOk'))}>{t('payrollSetup.test')}</Button>
              <Button size="sm" variant="ghost" icon={<Unplug className="h-4 w-4" aria-hidden="true" />} loading={busy === 'off'} onClick={() => void run('off', () => papi(`/tenants/${id}/payroll/bank`, { method: 'DELETE' }))}>{t('payrollSetup.disconnect')}</Button>
            </div>
          ) : undefined}
        />
        <CardBody className="pt-2">
          <form onSubmit={saveBank} className="grid gap-4 sm:grid-cols-2">
            <Field label={t('payrollSetup.host')}>{(p) => <Input {...p} name="host" required defaultValue={v.bank.host ?? ''} placeholder="sftp.yourbank.com" />}</Field>
            <Field label={t('payrollSetup.port')}>{(p) => <Input {...p} name="port" inputMode="numeric" defaultValue={v.bank.port ?? 22} />}</Field>
            <Field label={t('payrollSetup.username')}>{(p) => <Input {...p} name="username" required defaultValue={v.bank.username ?? ''} autoComplete="off" />}</Field>
            <Field label={t('payrollSetup.remoteDir')}>{(p) => <Input {...p} name="remoteDir" required defaultValue={v.bank.remoteDir ?? '/'} />}</Field>
            <div className="sm:col-span-2"><Field label={t('payrollSetup.hostKey')} hint={t('payrollSetup.hostKeyHint')}>{(p) => <Input {...p} name="hostKeySha256" required defaultValue={v.bank.hostKeySha256 ? `SHA256:${v.bank.hostKeySha256}` : ''} className="font-mono" />}</Field></div>
            <div className="sm:col-span-2"><Field label={t('payrollSetup.secret')} hint={v.bank.configured ? t('payrollSetup.secretKept') : t('payrollSetup.secretHint')}>{(p) => <Textarea {...p} name="secret" rows={2} required={!v.bank.configured} autoComplete="off" className="font-mono text-caption" />}</Field></div>
            <div className="sm:col-span-2"><Field label={t('payrollSetup.pgp')} hint={t('payrollSetup.pgpHint')}>{(p) => <Textarea {...p} name="pgpPublicKey" rows={2} className="font-mono text-caption" />}</Field></div>
            <label className="flex items-center gap-2 text-small sm:col-span-2"><input type="checkbox" name="autoSend" defaultChecked={v.bank.autoSend ?? true} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('payrollSetup.autoSend')}</label>
            <div className="sm:col-span-2"><Button type="submit" loading={busy === 'bank'}>{t('payrollSetup.saveBank')}</Button></div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
