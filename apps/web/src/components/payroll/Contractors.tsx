'use client';

import { FileDown, Plus, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { todayIso, useAction, useQuery } from '@/lib/useQuery';
import { AddressFields, readAddress } from './AddressFields';

const BOXES = ['048', '028', '020'] as const;
interface Payment { id: string; paidOn: string; box: (typeof BOXES)[number]; amount: number; taxWithheld: number; description: string }
interface Payee { id: string; kind: 'PERSON' | 'BUSINESS'; name: string; sin: string | null; businessNumber: string | null; paid: number; payments: Payment[] }
interface Slips { slips: Array<{ payeeId: string; name: string; total: number }>; under: number }

/** Payees who aren't employees (contract instructors, honoraria) and their T4As. */
export function Contractors() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery<Payee[]>(`/api/payees?year=${year}`);
  const slips = useQuery<Slips>(`/api/payroll/t4a?year=${year}`);
  const { run, busy } = useAction();
  const [adding, setAdding] = useState<'PERSON' | 'BUSINESS' | null>(null);
  const [paying, setPaying] = useState<Payee | null>(null);
  const [problems, setProblems] = useState<Array<{ code: string; name?: string }>>([]);
  const reload = async () => { await q.reload(); await slips.reload(); };

  async function addPayee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const body = { kind: adding, firstName: s('firstName'), lastName: s('lastName'), businessName: s('businessName'), businessNumber: s('bn'), sin: s('sin') ?? undefined, email: s('email'), address: readAddress(f) ?? null };
    const r = await run('payee', () => api('/api/payees', { method: 'POST', body }), t('t4a.payeeAdded'));
    if (r !== undefined) { setAdding(null); await reload(); }
  }
  async function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { paidOn: String(f.get('paidOn')), box: String(f.get('box')), amount: Number(f.get('amount')), taxWithheld: Number(f.get('tax') || 0), description: String(f.get('description')) };
    const r = await run('pay', () => api(`/api/payees/${paying!.id}/payments`, { method: 'POST', body }), t('t4a.paymentAdded'));
    if (r !== undefined) { setPaying(null); await reload(); }
  }
  async function download() {
    setProblems([]);
    const r = await apiDownload(`/api/payroll/t4a.xml?year=${year}`);
    if (r.ok) return saveBlob(r.blob, `T4A-${year}.xml`);
    if (r.error.code === 'FILING_INCOMPLETE') setProblems(((r.error.details as { problems?: Array<{ code: string; name?: string }> }) ?? {}).problems ?? []);
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('t4a.title', { year })} description={t('t4a.help')} action={<Select aria-label={t('t4a.year')} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}</Select>} />
        <CardBody className="grid gap-3 pt-2">
          {slips.data ? <p className="text-body text-ink">{t('t4a.slips', { count: slips.data.slips.length })}{slips.data.under ? <span className="text-muted"> · {t('t4a.under', { count: slips.data.under })}</span> : null}</p> : <Skeleton className="h-6" />}
          <Button size="sm" variant="secondary" className="justify-self-start" icon={<FileDown className="h-4 w-4" aria-hidden="true" />} disabled={!slips.data?.slips.length} onClick={() => void download()}>{t('t4a.xml')}</Button>
          {problems.length ? <div role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-small"><p className="font-semibold">{t('t4a.missingIntro', { defaultValue: t('payroll.filing.missing') })}</p><ul className="mt-1 list-disc pl-5">{problems.map((p, i) => <li key={i}>{t(`t4a.problems.${p.code}`, { name: p.name })}</li>)}</ul></div> : null}
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding('PERSON')}>{t('t4a.addPerson')}</Button>
        <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding('BUSINESS')}>{t('t4a.addBusiness')}</Button>
      </div>
      {q.loading ? <Skeleton className="h-40" /> : !q.data?.length ? <EmptyState icon={UserPlus} title={t('t4a.noneTitle')}>{t('t4a.noneBody')}</EmptyState> : (
        q.data.map((p) => (
          <Card key={p.id}>
            <CardHeader title={p.name} description={p.kind === 'PERSON' ? (p.sin ? t('t4a.sinOnFile', { sin: p.sin }) : t('t4a.noSin')) : (p.businessNumber ? t('t4a.bn', { bn: p.businessNumber }) : t('t4a.noBn'))} action={<StatusPill tone={p.paid > 500 ? 'brand' : 'neutral'}>{formatMoney(p.paid, lng)}</StatusPill>} />
            <CardBody className="grid gap-2 pt-2">
              {p.payments.length ? (
                <ul className="divide-y divide-line text-small">{p.payments.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{formatDate(`${x.paidOn}T12:00:00`, lng)} · {t(`t4a.boxes.${x.box}`)} · {x.description}</span><span className="tabular-nums">{formatMoney(x.amount, lng)}</span></li>)}</ul>
              ) : null}
              <Button size="sm" variant="secondary" className="justify-self-start" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setPaying(p)}>{t('t4a.addPayment')}</Button>
            </CardBody>
          </Card>
        ))
      )}
      <Dialog open={!!adding} onClose={() => setAdding(null)} title={adding === 'BUSINESS' ? t('t4a.addBusiness') : t('t4a.addPerson')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void addPayee(e)} className="grid gap-4">
          {adding === 'BUSINESS' ? (
            <>
              <Field label={t('t4a.businessName')}>{(f) => <Input {...f} name="businessName" required maxLength={120} />}</Field>
              <Field label={t('t4a.businessNumber')} hint={t('t4a.businessNumberHint')}>{(f) => <Input {...f} name="bn" maxLength={15} />}</Field>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('jobs.firstName')}>{(f) => <Input {...f} name="firstName" required maxLength={60} />}</Field>
              <Field label={t('jobs.lastName')}>{(f) => <Input {...f} name="lastName" required maxLength={60} />}</Field>
              <Field label={t('t4a.sin')} hint={t('t4a.sinHint')}>{(f) => <Input {...f} name="sin" inputMode="numeric" autoComplete="off" maxLength={11} />}</Field>
            </div>
          )}
          <Field label={t('jobs.email')}>{(f) => <Input {...f} name="email" type="email" maxLength={160} />}</Field>
          <AddressFields />
          <Button type="submit" className="justify-self-start" loading={busy === 'payee'}>{t('common.save')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!paying} onClose={() => setPaying(null)} title={t('t4a.paymentTo', { name: paying?.name ?? '' })} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void pay(e)} className="grid gap-4 sm:grid-cols-2">
          <Field label={t('t4a.paidOn')}>{(f) => <Input {...f} name="paidOn" type="date" required defaultValue={todayIso()} />}</Field>
          <Field label={t('t4a.box')}>{(f) => <Select {...f} name="box" defaultValue="048">{BOXES.map((b) => <option key={b} value={b}>{t(`t4a.boxes.${b}`)}</option>)}</Select>}</Field>
          <Field label={t('t4a.amount')}>{(f) => <Input {...f} name="amount" type="number" min={0.01} step={0.01} required inputMode="decimal" />}</Field>
          <Field label={t('t4a.tax')}>{(f) => <Input {...f} name="tax" type="number" min={0} step={0.01} inputMode="decimal" />}</Field>
          <div className="sm:col-span-2"><Field label={t('t4a.description')}>{(f) => <Input {...f} name="description" required minLength={2} maxLength={160} />}</Field></div>
          <Button type="submit" className="justify-self-start" loading={busy === 'pay'}>{t('common.save')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
