'use client';

import { Download, Landmark, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { cad } from '@/lib/billing';
import type { Debitable, Originator, PadBatch, PadDebit } from '@/lib/books';
import { formatDate } from '@/lib/format';
import { papi, pdownload, usePlatformQuery } from '@/lib/platform';

const BATCH_TONE: Record<PadBatch['status'], Tone> = { CREATED: 'new', SENT: 'brand', SETTLED: 'ok' };
const DEBIT_TONE: Record<PadDebit['status'], Tone> = { PENDING: 'pending', SETTLED: 'ok', RETURNED: 'danger' };
const today = () => new Date().toISOString().slice(0, 10);

/** Pre-authorized debits: collect plan charges from cities' bank accounts. */
export default function DebitsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const [date, setDate] = useState(today());
  const data = usePlatformQuery<{ date: string; invoices: Debitable[]; batches: PadBatch[] }>(`/billing/pad-debits?date=${date}`);
  const originator = usePlatformQuery<Originator | null>('/billing/pad-originator');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [returning, setReturning] = useState<PadDebit | null>(null);
  const [settling, setSettling] = useState<PadBatch | null>(null);
  const d = (iso: string | null) => (iso ? formatDate(iso, lng, 'dated') : '—');

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      await Promise.all([data.reload(), originator.reload()]);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
      return false;
    } finally {
      setBusy(null);
    }
  }
  const ready = (data.data?.invoices ?? []).filter((i) => i.ready);
  const chosen = picked ?? ready.map((i) => i.invoiceId);
  const total = ready.filter((i) => chosen.includes(i.invoiceId)).reduce((s, i) => s + i.amountCents, 0);

  async function saveOriginator(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const ok = await run('orig', () => papi('/billing/pad-originator', { method: 'PUT', body: { originatorId: s('originatorId'), dataCentre: s('dataCentre'), shortName: s('shortName'), longName: s('longName'), transactionCode: s('code') || undefined, returns: { institution: s('rInst'), transit: s('rTransit'), ...(s('rAccount') ? { account: s('rAccount') } : {}) } } }), t('debits.originatorSaved'));
    if (ok) setEditing(false);
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('debits.title')} description={t('debits.description')} />

      <Card>
        <CardHeader title={t('debits.originator')} description={t('debits.originatorHelp')} action={!editing ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{originator.data ? t('common.edit') : t('debits.setUp')}</Button> : undefined} />
        <CardBody className="pt-2 text-small">
          {editing ? (
            <form onSubmit={(e) => void saveOriginator(e)} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('debits.originatorId')}>{(p) => <Input {...p} name="originatorId" required pattern="[A-Za-z0-9]{1,10}" maxLength={10} defaultValue={originator.data?.originatorId} />}</Field>
                <Field label={t('debits.dataCentre')}>{(p) => <Input {...p} name="dataCentre" required pattern="\d{5}" maxLength={5} defaultValue={originator.data?.dataCentre} />}</Field>
                <Field label={t('debits.code')} hint={t('debits.codeHint')}>{(p) => <Input {...p} name="code" pattern="\d{3}" maxLength={3} defaultValue={originator.data?.transactionCode ?? '700'} />}</Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('debits.shortName')}>{(p) => <Input {...p} name="shortName" required maxLength={15} defaultValue={originator.data?.shortName ?? 'FLEXCITY HQ'} />}</Field>
                <Field label={t('debits.longName')}>{(p) => <Input {...p} name="longName" required maxLength={30} defaultValue={originator.data?.longName} />}</Field>
              </div>
              <p className="font-semibold">{t('debits.returnsAccount')}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('pad.institution')}>{(p) => <Input {...p} name="rInst" required pattern="\d{3}" maxLength={3} defaultValue={originator.data?.returns.institution} />}</Field>
                <Field label={t('pad.transit')}>{(p) => <Input {...p} name="rTransit" required pattern="\d{5}" maxLength={5} defaultValue={originator.data?.returns.transit} />}</Field>
                <Field label={t('pad.account')} hint={originator.data ? t('debits.keepAccount', { account: originator.data.returns.account }) : undefined}>{(p) => <Input {...p} name="rAccount" required={!originator.data} pattern="\d{5,12}" maxLength={12} autoComplete="off" />}</Field>
              </div>
              <div className="flex gap-2"><Button type="submit" loading={busy === 'orig'}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button></div>
            </form>
          ) : originator.data ? (
            <p>{t('debits.originatorLine', { id: originator.data.originatorId, centre: originator.data.dataCentre, code: originator.data.transactionCode, institution: originator.data.returns.institution, transit: originator.data.returns.transit, account: originator.data.returns.account, last: originator.data.lastFileNumber })}</p>
          ) : (
            <p className="text-muted">{t('debits.noOriginator')}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('debits.toDebit')}
          description={t('debits.toDebitHelp')}
          action={<div className="w-44"><Input aria-label={t('debits.debitDate')} type="date" value={date} onChange={(e) => { setDate(e.target.value); setPicked(null); }} /></div>}
        />
        <CardBody className="grid gap-4 pt-2">
          {!data.data ? (
            <Skeleton className="h-32" />
          ) : !data.data.invoices.length ? (
            <EmptyState icon={Landmark} title={t('debits.nothing')}>{t('debits.nothingHelp')}</EmptyState>
          ) : (
            <>
              <ul className="divide-y divide-line text-small">
                {data.data.invoices.map((i) => (
                  <li key={i.invoiceId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" disabled={!i.ready} checked={i.ready && chosen.includes(i.invoiceId)} onChange={(e) => setPicked(e.target.checked ? [...chosen, i.invoiceId] : chosen.filter((x) => x !== i.invoiceId))} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                      <span><span className="font-semibold">{i.payor}</span> · {i.number} · {t('debits.due', { date: d(i.dueDate) })}</span>
                    </label>
                    <span className="flex items-center gap-2">{!i.ready ? <StatusPill tone="warn">{t('debits.notice')}</StatusPill> : null}<span className="tabular-nums font-semibold">{cad(i.amountCents, lng)}</span></span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-small text-muted">{t('debits.selected', { count: chosen.length, total: cad(total, lng), date: d(date) })}</p>
                <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} disabled={!chosen.length || !originator.data} loading={busy === 'batch'} onClick={() => void run('batch', () => papi('/billing/pad-batches', { method: 'POST', body: { debitDate: date, invoiceIds: chosen } }), t('debits.batchCreated')).then(() => setPicked(null))}>{t('debits.createBatch')}</Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('debits.batches')} description={t('debits.batchesHelp')} />
        <CardBody className="grid gap-4 pt-2">
          {!data.data?.batches.length ? (
            <p className="text-small text-muted">{t('debits.noBatches')}</p>
          ) : (
            data.data.batches.map((b) => (
              <section key={b.id} className="rounded-2xl border border-line p-4">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="flex flex-wrap items-center gap-2 text-body-strong">{t('debits.file', { n: b.fileNumber })}<StatusPill tone={BATCH_TONE[b.status]}>{t(`debits.batchStatus.${b.status}`)}</StatusPill></span>
                    <span className="text-caption text-muted">{t('debits.batchLine', { count: b.count, total: cad(b.totalCents, lng), date: d(b.debitDate) })}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {b.status !== 'SETTLED' ? <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy === `file${b.id}`} onClick={() => void run(`file${b.id}`, () => pdownload(`/billing/pad-batches/${b.id}/file`, `fh-pad-${b.fileNumber}.txt`))}>{t('debits.download')}</Button> : null}
                    {b.status === 'CREATED' ? (
                      <>
                        <Button size="sm" icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={busy === `sent${b.id}`} onClick={() => void run(`sent${b.id}`, () => papi(`/billing/pad-batches/${b.id}/sent`, { method: 'POST' }), t('debits.markedSent'))}>{t('debits.markSent')}</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} loading={busy === `del${b.id}`} onClick={() => void run(`del${b.id}`, () => papi(`/billing/pad-batches/${b.id}`, { method: 'DELETE' }), t('debits.discarded'))}>{t('debits.discard')}</Button>
                      </>
                    ) : null}
                    {b.status === 'SENT' ? <Button size="sm" onClick={() => setSettling(b)}>{t('debits.settle')}</Button> : null}
                  </span>
                </header>
                <ul className="mt-3 divide-y divide-line text-small">
                  {b.debits.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{x.payor} · {x.number}{x.returnReason ? <span className="text-danger"> · {t('debits.returnedLine', { reason: x.returnReason, date: d(x.returnedOn) })}</span> : null}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{cad(x.amountCents, lng)}</span>
                        <StatusPill tone={DEBIT_TONE[x.status]}>{t(`debits.debitStatus.${x.status}`)}</StatusPill>
                        {b.status !== 'CREATED' && x.status !== 'RETURNED' ? <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setReturning(x)}>{t('debits.return')}</Button> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardBody>
      </Card>

      <Dialog open={!!settling} onClose={() => setSettling(null)} title={t('debits.settleTitle', { n: settling?.fileNumber ?? '' })} description={t('debits.settleHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); const on = String(new FormData(e.currentTarget).get('on')); void run('settle', () => papi(`/billing/pad-batches/${settling!.id}/settle`, { method: 'POST', body: { settledOn: on } }), t('debits.settled')).then((ok) => ok && setSettling(null)); }}>
          <Field label={t('debits.settledOn')}>{(p) => <Input {...p} name="on" type="date" required defaultValue={settling?.debitDate} />}</Field>
          <div><Button type="submit" loading={busy === 'settle'}>{t('debits.settle')}</Button></div>
        </form>
      </Dialog>
      <Dialog open={!!returning} onClose={() => setReturning(null)} title={t('debits.returnTitle')} description={t('debits.returnHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run('ret', () => papi(`/billing/pad-debits/${returning!.id}/return`, { method: 'POST', body: { reason: String(f.get('reason')), returnedOn: String(f.get('on')) } }), t('debits.returned')).then((ok) => ok && setReturning(null)); }}>
          <Field label={t('debits.returnReason')} hint={t('debits.returnReasonHint')}>{(p) => <Input {...p} name="reason" required minLength={2} maxLength={80} />}</Field>
          <Field label={t('debits.returnedOn')}>{(p) => <Input {...p} name="on" type="date" required defaultValue={today()} />}</Field>
          <div><Button type="submit" variant="danger" loading={busy === 'ret'}>{t('debits.return')}</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
