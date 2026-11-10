'use client';

import { Banknote, FileText, Landmark, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatementView } from '@/components/payroll/StatementView';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { MyPay, Statement } from '@/lib/payroll';
import { useAction, useQuery } from '@/lib/useQuery';

export default function MyPayPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <MyPayInner />
    </Suspense>
  );
}

function MyPayInner() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const params = useSearchParams();
  const data = useQuery<MyPay>('/api/me/pay');
  const [open, setOpen] = useState<string | null>(params.get('statement'));
  const statement = useQuery<Statement>(open ? `/api/me/pay-statements/${open}` : null);

  if (data.error) return <ErrorNotice onRetry={data.reload} />;
  if (!data.data) return <Skeleton className="h-64" />;
  const d = data.data;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('myPay.title')} description={t('myPay.description')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t('myPay.statements')} />
          <CardBody className="pt-2">
            {!d.statements.length ? (
              <EmptyState icon={FileText} title={t('myPay.noStatements')}>{t('myPay.noStatementsHelp')}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {d.statements.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setOpen(s.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-2 py-3 text-left hover:bg-surface">
                      <span>
                        <span className="block text-body-strong">{formatDate(s.payDate, lng, 'dated')}</span>
                        <span className="text-caption text-muted">{t('myPay.grossLine', { gross: formatMoney(s.gross, lng), deductions: formatMoney(s.totalDeductions, lng) })}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-body-strong tabular-nums">{formatMoney(s.net, lng)}</span>
                        <span className="text-caption text-muted">{s.deposit ? t('payroll.depositTo', { account: s.deposit }) : t('payroll.byCheque')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <div className="grid content-start gap-6">
          <DirectDeposit data={d} reload={data.reload} />
          <TaxCredits data={d} reload={data.reload} />
        </div>
      </div>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={t('payroll.statement')}>
        {statement.data ? <StatementView s={statement.data} /> : <Skeleton className="h-64" />}
      </Dialog>
    </div>
  );
}

function DirectDeposit({ data, reload }: { data: MyPay; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const active = data.bankAccounts.find((b) => b.status === 'ACTIVE');
  const pending = data.bankAccounts.find((b) => b.status === 'PENDING');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const r = await run(
      'bank',
      () => api('/api/me/bank-accounts', { method: 'POST', body: { holderName: s('holder'), institution: s('institution'), transit: s('transit'), account: s('account').replace(/\s/g, ''), agree: f.get('agree') === 'on' } }),
      t('myPay.bankSaved'),
    );
    if (r !== undefined) {
      setEditing(false);
      await reload();
    }
  }

  return (
    <Card>
      <CardHeader title={t('myPay.directDeposit')} description={t('myPay.directDepositHelp')} action={!editing ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{active || pending ? t('myPay.change') : t('myPay.setUp')}</Button> : undefined} />
      <CardBody className="grid gap-3 pt-2">
        {active ? (
          <p className="flex items-center gap-2"><Landmark className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('myPay.activeAccount', { account: active.account, transit: active.transit, institution: active.institution })}</p>
        ) : !pending ? (
          <p className="text-muted">{t('myPay.noAccount')}</p>
        ) : null}
        {pending ? (
          <p className="flex flex-wrap items-center gap-2">
            <StatusPill tone="warn">{t('myPay.pending')}</StatusPill>
            {t('myPay.pendingAccount', { account: pending.account })}
          </p>
        ) : null}
        {editing ? (
          <form onSubmit={(e) => void save(e)} className="grid gap-3 rounded-2xl border border-line p-4">
            <Field label={t('myPay.holder')}>{(p) => <Input {...p} name="holder" required maxLength={30} autoComplete="name" />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('myPay.institution')} hint={t('myPay.institutionHint')}>{(p) => <Input {...p} name="institution" required inputMode="numeric" pattern="\d{3}" maxLength={3} autoComplete="off" />}</Field>
              <Field label={t('myPay.transit')} hint={t('myPay.transitHint')}>{(p) => <Input {...p} name="transit" required inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="off" />}</Field>
            </div>
            <Field label={t('myPay.account')}>{(p) => <Input {...p} name="account" required inputMode="numeric" pattern="[\d ]{5,15}" maxLength={15} autoComplete="off" />}</Field>
            <label className="flex items-start gap-2 text-small">
              <input type="checkbox" name="agree" required className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
              <span>{data.consent}</span>
            </label>
            <p className="flex items-start gap-2 text-caption text-muted"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />{t('myPay.bankSecurity')}</p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={busy === 'bank'}>{t('myPay.saveBank')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}

function TaxCredits({ data, reload }: { data: MyPay; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const p = data.profile;
  const [key, setKey] = useState(0);
  useEffect(() => setKey((k) => k + 1), [p.federalClaim, p.provincialClaim, p.extraTaxPerPeriod, p.sin]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (String(f.get(k) ?? '').trim() ? Number(f.get(k)) : null);
    const sin = String(f.get('sin') ?? '').trim();
    const r = await run(
      'td1',
      () => api('/api/me/pay-profile', { method: 'PUT', body: { federalClaim: num('federal'), provincialClaim: num('provincial'), extraTaxPerPeriod: num('extra') ?? 0, ...(sin ? { sin } : {}) } }),
      t('myPay.td1Saved'),
    );
    if (r !== undefined) await reload();
  }

  return (
    <Card>
      <CardHeader title={t('myPay.taxCredits')} description={t('myPay.taxCreditsHelp')} />
      <CardBody className="pt-2">
        <form key={key} onSubmit={(e) => void save(e)} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('myPay.federalClaim')} hint={t('myPay.blankBasic')}>{(f) => <Input {...f} name="federal" type="number" min={0} step="0.01" defaultValue={p.federalClaim ?? ''} />}</Field>
            <Field label={t('myPay.provincialClaim')} hint={t('myPay.blankBasic')}>{(f) => <Input {...f} name="provincial" type="number" min={0} step="0.01" defaultValue={p.provincialClaim ?? ''} />}</Field>
          </div>
          <Field label={t('myPay.extraTax')}>{(f) => <Input {...f} name="extra" type="number" min={0} step="0.01" defaultValue={p.extraTaxPerPeriod || ''} />}</Field>
          {p.sin ? (
            <p className="text-small">{t('myPay.sinOnFile', { sin: p.sin })}</p>
          ) : (
            <Field label={t('myPay.sin')} hint={t('myPay.sinHint')}>{(f) => <Input {...f} name="sin" inputMode="numeric" maxLength={11} autoComplete="off" />}</Field>
          )}
          {p.td1SignedAt ? <p className="text-caption text-muted">{t('myPay.td1Signed', { date: formatDate(p.td1SignedAt.slice(0, 10), i18n.language, 'dated') })}</p> : null}
          <div><Button type="submit" size="sm" icon={<Banknote className="h-4 w-4" aria-hidden="true" />} loading={busy === 'td1'}>{t('common.save')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
