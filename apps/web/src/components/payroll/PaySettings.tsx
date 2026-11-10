'use client';

import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface BankLinkView { configured: boolean; host?: string; port?: number; username?: string; remoteDir?: string; hostKeySha256?: string; pgpFingerprint?: string | null; autoSend?: boolean; credentialKind?: 'password' | 'privateKey' }
interface Settings { bank: BankLinkView; businessNumber?: string; originatorId?: string; originatorShortName?: string; originatorLongName?: string; destinationDataCentre?: string; returnsInstitution?: string; returnsTransit?: string; returnsAccount: string | null; employerAddress?: string; twoPersonApproval: boolean; requirePasskey: boolean }

/** CRA payroll account and the direct deposit details the city's bank provides. */
export function PaySettings() {
  const { t } = useTranslation();
  const { can } = useSession();
  const data = useQuery<Settings>('/api/payroll/settings');
  const { run, busy } = useAction();
  const editable = can('payroll.approve');
  if (!data.data) return <Skeleton className="h-64" />;
  const s = data.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim() || null;
    const account = v('returnsAccount');
    const r = await run(
      'save',
      () =>
        api('/api/payroll/settings', {
          method: 'PUT',
          body: {
            businessNumber: v('businessNumber'),
            employerAddress: v('employerAddress'),
            originatorId: v('originatorId'),
            originatorShortName: v('originatorShortName'),
            originatorLongName: v('originatorLongName'),
            destinationDataCentre: v('destinationDataCentre'),
            returnsInstitution: v('returnsInstitution'),
            returnsTransit: v('returnsTransit'),
            ...(account ? { returnsAccount: account } : {}),
            twoPersonApproval: f.get('twoPerson') === 'on',
            requirePasskey: f.get('passkey') === 'on',
          },
        }),
      t('profile.saved'),
    );
    if (r !== undefined) await data.reload();
  }
  const field = (name: keyof Settings, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}>{(p) => <Input {...p} name={name} defaultValue={(s[name] as string | undefined) ?? ''} disabled={!editable} {...props} />}</Field>
  );
  return (
    <form onSubmit={(e) => void save(e)} className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader title={t('payroll.employerTitle')} />
        <CardBody className="grid gap-4 pt-2 sm:grid-cols-2">
          {field('businessNumber', t('payroll.businessNumber'), { placeholder: '123456789RP0001' })}
          {field('employerAddress', t('payroll.employerAddress'))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('payroll.depositTitle')} description={t('payroll.depositHelp')} />
        <CardBody className="grid gap-4 pt-2 sm:grid-cols-2">
          {field('originatorId', t('payroll.originatorId'), { maxLength: 10 })}
          {field('destinationDataCentre', t('payroll.dataCentre'), { inputMode: 'numeric', maxLength: 5 })}
          {field('originatorShortName', t('payroll.shortName'), { maxLength: 15 })}
          {field('originatorLongName', t('payroll.longName'), { maxLength: 30 })}
          {field('returnsInstitution', t('payroll.returnsInstitution'), { inputMode: 'numeric', maxLength: 3 })}
          {field('returnsTransit', t('payroll.returnsTransit'), { inputMode: 'numeric', maxLength: 5 })}
          <Field label={t('payroll.returnsAccount')} hint={s.returnsAccount ? t('payroll.onFile', { account: s.returnsAccount }) : undefined}>{(p) => <Input {...p} name="returnsAccount" inputMode="numeric" maxLength={12} disabled={!editable} autoComplete="off" />}</Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('payroll.safeguards')} />
        <CardBody className="grid gap-3 pt-2 text-small">
          <label className="flex items-start gap-2"><input type="checkbox" name="twoPerson" defaultChecked={s.twoPersonApproval} disabled={!editable} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span><span className="font-semibold">{t('payroll.twoPerson')}</span><span className="block text-caption text-muted">{t('payroll.twoPersonHelp')}</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="passkey" defaultChecked={s.requirePasskey} disabled={!editable} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span><span className="font-semibold">{t('payroll.passkey')}</span><span className="block text-caption text-muted">{t('payroll.passkeyHelp')}</span></span></label>
        </CardBody>
      </Card>
      {editable ? <div><Button type="submit" loading={busy === 'save'}>{t('common.save')}</Button></div> : null}
    </form>
  );
}

/** Host-to-host connection: approved pay runs go straight to the city's bank. */
export function BankConnection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const data = useQuery<Settings>('/api/payroll/settings');
  const { run, busy } = useAction();
  const editable = can('payroll.approve');
  if (!data.data) return <Skeleton className="h-48" />;
  const b = data.data.bank;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const secret = v('secret');
    const body = {
      host: v('host'),
      port: Number(v('port') || 22),
      username: v('username'),
      remoteDir: v('remoteDir'),
      hostKeySha256: v('fingerprint'),
      pgpPublicKey: v('pgp') || null,
      autoSend: f.get('autoSend') === 'on',
      ...(secret ? (secret.includes('PRIVATE KEY') ? { privateKey: secret } : { password: secret }) : {}),
    };
    const r = await run('bank', () => api('/api/payroll/bank-connection', { method: 'PUT', body }), t('payroll.bank.saved'));
    if (r !== undefined) await data.reload();
  }
  async function test() {
    const r = await run('test', () => api<{ files: number }>('/api/payroll/bank-connection/test', { method: 'POST' }));
    if (r) await run('noop', async () => r, t('payroll.bank.testOk', { count: r.files }));
  }
  async function disconnect() {
    const r = await run('off', () => api('/api/payroll/bank-connection', { method: 'DELETE' }), t('payroll.bank.removed'));
    if (r !== undefined) await data.reload();
  }
  return (
    <Card className="max-w-3xl">
      <CardHeader title={t('payroll.bank.title')} description={t('payroll.bank.help')} />
      <CardBody className="pt-2">
        <form onSubmit={(e) => void save(e)} className="grid gap-4">
          {b.configured ? <p className="rounded-xl bg-ok/10 px-3 py-2 text-small">{t('payroll.bank.connected', { host: b.host, dir: b.remoteDir })}{b.pgpFingerprint ? ` ${t('payroll.bank.encrypted')}` : ''}</p> : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Field label={t('payroll.bank.host')}>{(p) => <Input {...p} name="host" required defaultValue={b.host ?? ''} placeholder="sftp.yourbank.com" disabled={!editable} />}</Field>
            <Field label={t('payroll.bank.port')}>{(p) => <Input {...p} name="port" type="number" min={1} max={65535} defaultValue={b.port ?? 22} disabled={!editable} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('payroll.bank.username')}>{(p) => <Input {...p} name="username" required defaultValue={b.username ?? ''} autoComplete="off" disabled={!editable} />}</Field>
            <Field label={t('payroll.bank.folder')}>{(p) => <Input {...p} name="remoteDir" required defaultValue={b.remoteDir ?? '/inbound'} disabled={!editable} />}</Field>
          </div>
          <Field label={t('payroll.bank.fingerprint')} hint={t('payroll.bank.fingerprintHint')}>{(p) => <Input {...p} name="fingerprint" required defaultValue={b.hostKeySha256 ? `SHA256:${b.hostKeySha256}` : ''} placeholder="SHA256:…" className="font-mono" disabled={!editable} />}</Field>
          <Field label={b.configured ? t('payroll.bank.secretReplace') : t('payroll.bank.secret')} hint={t('payroll.bank.secretHint')}>{(p) => <Textarea {...p} name="secret" rows={3} autoComplete="off" className="font-mono text-caption" disabled={!editable} />}</Field>
          <Field label={t('payroll.bank.pgp')} hint={b.pgpFingerprint ? t('payroll.bank.pgpOnFile', { fingerprint: b.pgpFingerprint.slice(-16) }) : t('payroll.bank.pgpHint')}>{(p) => <Textarea {...p} name="pgp" rows={3} className="font-mono text-caption" disabled={!editable} />}</Field>
          <label className="flex items-start gap-2 text-small"><input type="checkbox" name="autoSend" defaultChecked={b.autoSend ?? false} disabled={!editable} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span><span className="font-semibold">{t('payroll.bank.autoSend')}</span><span className="block text-caption text-muted">{t('payroll.bank.autoSendHelp')}</span></span></label>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={busy === 'bank'}>{b.configured ? t('common.save') : t('payroll.bank.connect')}</Button>
              {b.configured ? <Button size="sm" variant="secondary" loading={busy === 'test'} onClick={() => void test()}>{t('payroll.bank.test')}</Button> : null}
              {b.configured ? <Button size="sm" variant="ghost" loading={busy === 'off'} onClick={() => void disconnect()}>{t('payroll.bank.disconnect')}</Button> : null}
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
