'use client';

import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface Settings { businessNumber?: string; originatorId?: string; originatorShortName?: string; originatorLongName?: string; destinationDataCentre?: string; returnsInstitution?: string; returnsTransit?: string; returnsAccount: string | null; employerAddress?: string; twoPersonApproval: boolean; requirePasskey: boolean }

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
