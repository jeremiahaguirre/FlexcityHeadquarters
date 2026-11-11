'use client';

import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import { AddressFields, type MailingAddress, readAddress } from './AddressFields';

interface BankLinkView { configured: boolean; host?: string; port?: number; username?: string; remoteDir?: string; hostKeySha256?: string; pgpFingerprint?: string | null; autoSend?: boolean; credentialKind?: 'password' | 'privateKey' }
interface Settings { bank: BankLinkView; businessNumber?: string; quebecNumber?: string; rqPreparerNumber?: string; rqCertificationNumber?: string; rl1FirstSlip?: number; quebecSector?: 'public' | 'private'; transmitterNumber?: string; filingContact?: { name: string; phone: string; email?: string | null } | null; employerMailing?: MailingAddress | null; originatorId?: string; originatorShortName?: string; originatorLongName?: string; destinationDataCentre?: string; returnsInstitution?: string; returnsTransit?: string; returnsAccount: string | null; employerAddress?: string; twoPersonApproval: boolean; requirePasskey: boolean; lieu?: { enabled?: boolean; capHours?: number; takeWithinMonths?: number }; mileage?: { centsPerKm?: number; centsAfter?: number; tierKm?: number; receiptOver?: number } }

/** CRA payroll account and the direct deposit details the city's bank provides. */
export function PaySettings() {
  const { t } = useTranslation();
  const { can } = useSession();
  const data = useQuery<Settings>('/api/payroll/settings');
  const { run, busy } = useAction();
  const editable = can('payroll.approve');
  const [lieuOn, setLieuOn] = useState<boolean | null>(null);
  if (!data.data) return <Skeleton className="h-64" />;
  const s = data.data;
  const banking = lieuOn ?? s.lieu?.enabled ?? false;
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
            quebecNumber: v('quebecNumber'),
            rqPreparerNumber: v('rqPreparerNumber'),
            rqCertificationNumber: v('rqCertificationNumber'),
            rl1FirstSlip: v('rl1FirstSlip') ? Number(v('rl1FirstSlip')) : null,
            quebecSector: v('quebecSector'),
            transmitterNumber: v('transmitterNumber'),
            ...(v('contactName') || v('contactPhone') ? { filingContact: { name: v('contactName') ?? '', phone: v('contactPhone') ?? '', email: v('contactEmail') } } : {}),
            ...(readAddress(f, 'emp_') ? { employerMailing: readAddress(f, 'emp_') } : {}),
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
            mileage: { centsPerKm: Number(f.get('kmRate') || 72), centsAfter: Number(f.get('kmRateAfter') || 66), tierKm: Number(f.get('kmTier') || 5000), receiptOver: Number(f.get('receiptOver') || 25) },
            lieu: { enabled: f.get('lieuOn') === 'on', capHours: Number(f.get('lieuCap') || 80), takeWithinMonths: Number(f.get('lieuMonths') || 12) },
          },
        }),
      t('profile.saved'),
    );
    if (r !== undefined) await data.reload();
  }
  const field = (name: keyof Settings, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}>{(p) => <Input {...p} name={name} defaultValue={(s[name] as string | undefined) ?? ''} disabled={!editable} autoCorrect="off" spellCheck={false} {...props} />}</Field>
  );
  return (
    <form onSubmit={(e) => void save(e)} className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader title={t('payroll.employerTitle')} />
        <CardBody className="grid gap-4 pt-2 sm:grid-cols-2">
          {field('businessNumber', t('payroll.businessNumber'), { placeholder: '123456789RP0001' })}
          {field('quebecNumber', t('payroll.quebecNumber'), { placeholder: '1234567890RS0001' })}
          <Field label={t('payroll.quebecSector')} hint={t('payroll.quebecSectorHint')}>
            {(p) => (
              <Select {...p} name="quebecSector" defaultValue={s.quebecSector ?? 'public'} disabled={!editable}>
                <option value="public">{t('payroll.sector.public')}</option>
                <option value="private">{t('payroll.sector.private')}</option>
              </Select>
            )}
          </Field>
          {field('employerAddress', t('payroll.employerAddress'))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('payroll.filingTitle')} description={t('payroll.filingHelp')} />
        <CardBody className="grid gap-4 pt-2">
          <AddressFields prefix="emp_" value={s.employerMailing} disabled={!editable} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('payroll.contactName')}>{(p) => <Input {...p} name="contactName" defaultValue={s.filingContact?.name ?? ''} disabled={!editable} />}</Field>
            <Field label={t('payroll.contactPhone')}>{(p) => <Input {...p} name="contactPhone" type="tel" defaultValue={s.filingContact?.phone ?? ''} disabled={!editable} />}</Field>
            <Field label={t('payroll.contactEmail')}>{(p) => <Input {...p} name="contactEmail" type="email" defaultValue={s.filingContact?.email ?? ''} disabled={!editable} />}</Field>
          </div>
          <div className="sm:max-w-xs">{field('transmitterNumber', t('payroll.transmitterNumber'), { placeholder: 'MM123456' })}</div>
          <div className="grid gap-4 sm:grid-cols-3">
            {field('rqPreparerNumber', t('payroll.rqPreparerNumber'), { placeholder: 'NP123456' })}
            {field('rqCertificationNumber', t('payroll.rqCertificationNumber'), { placeholder: 'RQ-26-01-ABC' })}
            <Field label={t('payroll.rl1FirstSlip')} hint={t('payroll.rl1FirstSlipHint')}>{(p) => <Input {...p} name="rl1FirstSlip" inputMode="numeric" pattern="\d{1,8}" defaultValue={s.rl1FirstSlip ?? ''} disabled={!editable} />}</Field>
          </div>
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
      <Card>
        <CardHeader title={t('expenses.settingsTitle')} description={t('expenses.settingsHelp')} />
        <CardBody className="grid gap-4 pt-2 text-small sm:grid-cols-2">
          <Field label={t('expenses.rateFirst')}>{(p) => <Input {...p} name="kmRate" type="number" min={1} max={500} step={0.5} defaultValue={s.mileage?.centsPerKm ?? 72} disabled={!editable} />}</Field>
          <Field label={t('expenses.rateAfter')}>{(p) => <Input {...p} name="kmRateAfter" type="number" min={1} max={500} step={0.5} defaultValue={s.mileage?.centsAfter ?? 66} disabled={!editable} />}</Field>
          <Field label={t('expenses.tier')}>{(p) => <Input {...p} name="kmTier" type="number" min={0} max={100000} step={100} defaultValue={s.mileage?.tierKm ?? 5000} disabled={!editable} />}</Field>
          <Field label={t('expenses.receiptOver')}>{(p) => <Input {...p} name="receiptOver" type="number" min={0} max={10000} step={1} defaultValue={s.mileage?.receiptOver ?? 25} disabled={!editable} />}</Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('lieu.settingsTitle')} description={t('lieu.settingsHelp')} />
        <CardBody className="grid gap-4 pt-2 text-small sm:grid-cols-2">
          <label className="flex items-start gap-2 sm:col-span-2"><input type="checkbox" name="lieuOn" defaultChecked={s.lieu?.enabled ?? false} onChange={(e) => setLieuOn(e.target.checked)} disabled={!editable} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span><span className="font-semibold">{t('lieu.settingsOn')}</span><span className="block text-caption text-muted">{t('lieu.settingsOnHelp')}</span></span></label>
          <Field label={t('lieu.cap')} hint={t('lieu.capHint')}>{(p) => <Input {...p} name="lieuCap" readOnly={!banking} className={banking ? undefined : 'opacity-70'} type="number" min={1} max={1000} step={1} defaultValue={s.lieu?.capHours ?? 80} disabled={!editable} />}</Field>
          <Field label={t('lieu.months')} hint={t('lieu.monthsHint')}>{(p) => <Input {...p} name="lieuMonths" readOnly={!banking} className={banking ? undefined : 'opacity-70'} type="number" min={1} max={36} step={1} defaultValue={s.lieu?.takeWithinMonths ?? 12} disabled={!editable} />}</Field>
        </CardBody>
      </Card>
      {editable ? (
        <div className="fh-savebar sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 p-3 shadow-card backdrop-blur lg:bottom-4">
          <p className="text-small text-muted">{t('payroll.saveAllHint')}</p>
          <Button type="submit" loading={busy === 'save'}>{t('payroll.saveAll')}</Button>
        </div>
      ) : null}
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
  const [lieuOn, setLieuOn] = useState<boolean | null>(null);
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
      ...(v('pgp') ? { pgpPublicKey: v('pgp') } : {}),
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
            <Field label={t('payroll.bank.host')}>{(p) => <Input {...p} name="host" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={b.host ?? ''} placeholder="sftp.yourbank.com" disabled={!editable} />}</Field>
            <Field label={t('payroll.bank.port')}>{(p) => <Input {...p} name="port" type="number" min={1} max={65535} defaultValue={b.port ?? 22} disabled={!editable} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('payroll.bank.username')}>{(p) => <Input {...p} name="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={b.username ?? ''} autoComplete="off" disabled={!editable} />}</Field>
            <Field label={t('payroll.bank.folder')}>{(p) => <Input {...p} name="remoteDir" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={b.remoteDir ?? '/inbound'} disabled={!editable} />}</Field>
          </div>
          <Field label={t('payroll.bank.fingerprint')} hint={t('payroll.bank.fingerprintHint')}>{(p) => <Input {...p} name="fingerprint" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={b.hostKeySha256 ? `SHA256:${b.hostKeySha256}` : ''} placeholder="SHA256:…" className="font-mono" disabled={!editable} />}</Field>
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
