'use client';

import { ArrowLeft, Ban, Banknote, Plus, Printer, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { type InvoiceRow, STATUS_TONE, cad } from '@/lib/billing';
import { formatDate } from '@/lib/format';
import { papi, usePlatformQuery } from '@/lib/platform';

interface Detail extends InvoiceRow {
  issuer: { legalName: string; address: string; email: string; gstNumber: string; qstNumber: string; remittance: string };
}
interface EditLine { description: string; quantity: string; unit: string }

function Invoice() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const inv = usePlatformQuery<Detail>(id ? `/billing/invoices/${id}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'pay' | 'void' | 'send' | 'credit' | 'writeoff' | null>(null);
  const [lines, setLines] = useState<EditLine[] | null>(null);
  const i = inv.data;
  useEffect(() => {
    if (i?.status === 'DRAFT') setLines(i.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unit: (l.unitCents / 100).toFixed(2) })));
  }, [i]);
  if (inv.error) return <ErrorNotice onRetry={inv.reload} />;
  if (!i) return <Skeleton className="h-[40rem]" />;

  const d = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00`, lng, 'dated') : '—');
  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'ok');
      setDialog(null);
      await inv.reload();
    } catch (e) {
      toast(e instanceof ApiError ? t(`billing.errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }
  const draftLines = lines?.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity.replace(',', '.')) || 0, unitCents: Math.round(Number(l.unit.replace(',', '.')) * 100) || 0 })) ?? [];
  const dirty = i.status === 'DRAFT' && JSON.stringify(draftLines) !== JSON.stringify(i.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitCents: l.unitCents })));
  const setLine = (k: number, patch: Partial<EditLine>) => setLines((ls) => ls!.map((l, j) => (j === k ? { ...l, ...patch } : l)));

  return (
    <div className="grid gap-5">
      {/* Actions: never printed */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/platform/billing" className="flex items-center gap-1.5 rounded-lg text-small font-semibold text-brand-text hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('billing.title')}
        </Link>
        <div className="flex flex-wrap gap-2">
          {i.status === 'DRAFT' ? (
            <>
              {dirty ? (
                <Button variant="secondary" loading={busy === 'save'} onClick={() => void act('save', () => papi(`/billing/invoices/${id}`, { method: 'PATCH', body: { lines: draftLines } }), t('billing.saved'))}>
                  {t('common.save')}
                </Button>
              ) : null}
              <Button variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'discard'} onClick={() => void act('discard', () => papi(`/billing/invoices/${id}/void`, { method: 'POST', body: { reason: 'Draft discarded' } }), t('billing.discarded')).then(() => router.replace('/platform/billing'))}>
                {t('billing.discard')}
              </Button>
              <Button icon={<Send className="h-4 w-4" aria-hidden="true" />} disabled={dirty} onClick={() => setDialog('send')}>
                {t('billing.send')}
              </Button>
            </>
          ) : null}
          {['SENT', 'PARTIAL', 'OVERDUE'].includes(i.status) ? (
            <>
              <Button variant="ghost" icon={<Ban className="h-4 w-4" aria-hidden="true" />} disabled={i.paidCents > 0} onClick={() => setDialog('void')}>
                {t('billing.void')}
              </Button>
              <Button variant="ghost" onClick={() => setDialog('credit')}>{t('billing.credit')}</Button>
              <Button variant="ghost" onClick={() => setDialog('writeoff')}>{t('billing.writeOff')}</Button>
              <Button icon={<Banknote className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('pay')}>
                {t('billing.recordPayment')}
              </Button>
            </>
          ) : null}
          <Button variant="secondary" icon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={() => window.print()}>
            {t('billing.print')}
          </Button>
        </div>
      </div>

      {/* The invoice itself: paper-like, prints on one page */}
      <article className="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-white p-6 text-[#0B1F22] shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="grid gap-2">
            <Logo size={34} />
            <p className="whitespace-pre-line text-small text-[#56696B]">{[i.issuer.legalName, i.issuer.address, i.issuer.email].filter(Boolean).join('\n')}</p>
          </div>
          <div className="text-right">
            <p className="text-label uppercase tracking-[0.18em] text-[#56696B]">{t('billing.invoice')}</p>
            <p className="font-display text-title">{i.number ?? t('billing.draftLabel')}</p>
            <div className="mt-1 print:hidden">
              <StatusPill tone={STATUS_TONE[i.status]}>{t(`billing.status.${i.status}`)}</StatusPill>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-label uppercase text-[#56696B]">{t('billing.billTo')}</p>
            <p className="mt-1 text-body-strong">{i.billTo.legalName}</p>
            <p className="whitespace-pre-line text-small text-[#56696B]">{[i.billTo.contactName, ...i.billTo.address, i.billTo.email].filter(Boolean).join('\n')}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small sm:justify-self-end">
            <dt className="text-[#56696B]">{t('billing.period')}</dt>
            <dd className="text-right tabular-nums">{d(i.periodStart)} – {d(i.periodEnd)}</dd>
            <dt className="text-[#56696B]">{t('billing.issued')}</dt>
            <dd className="text-right tabular-nums">{d(i.issueDate)}</dd>
            <dt className="text-[#56696B]">{t('billing.due')}</dt>
            <dd className="text-right font-semibold tabular-nums">{d(i.dueDate)}</dd>
            {i.poNumber ? (
              <>
                <dt className="text-[#56696B]">{t('billing.po')}</dt>
                <dd className="text-right">{i.poNumber}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <table className="mt-8 w-full text-small">
          <thead>
            <tr className="border-b-2 border-[#0B1F22] text-left text-label uppercase text-[#56696B]">
              <th className="py-2 font-semibold">{t('billing.lineDescription')}</th>
              <th className="py-2 pl-3 text-right font-semibold">{t('billing.qty')}</th>
              <th className="whitespace-nowrap py-2 pl-4 text-right font-semibold">{t('billing.unit')}</th>
              <th className="py-2 pl-4 text-right font-semibold">{t('billing.amount')}</th>
              {i.status === 'DRAFT' ? <th className="w-8 print:hidden" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#D9E3E1]">
            {i.status === 'DRAFT' && lines
              ? lines.map((l, k) => (
                  <tr key={k} className="align-top">
                    <td className="py-1.5 pr-2">
                      <Input aria-label={t('billing.lineDescription')} value={l.description} onChange={(e) => setLine(k, { description: e.target.value })} className="h-9 text-small" />
                    </td>
                    <td className="w-20 py-1.5 pr-2">
                      <Input aria-label={t('billing.qty')} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(k, { quantity: e.target.value })} className="h-9 text-right text-small" />
                    </td>
                    <td className="w-28 py-1.5 pr-2">
                      <Input aria-label={t('billing.unit')} inputMode="decimal" value={l.unit} onChange={(e) => setLine(k, { unit: e.target.value })} className="h-9 text-right text-small" />
                    </td>
                    <td className="whitespace-nowrap py-2.5 pl-4 text-right tabular-nums">{cad(draftLines[k]!.quantity * draftLines[k]!.unitCents, lng)}</td>
                    <td className="py-1.5 text-right print:hidden">
                      <button type="button" aria-label={t('settings.remove')} onClick={() => setLines((ls) => ls!.filter((_, j) => j !== k))} className="grid h-9 w-8 place-items-center rounded-lg text-[#56696B] hover:bg-[#EAF1EF]">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))
              : i.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 pr-3">{l.description}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{l.quantity}</td>
                    <td className="whitespace-nowrap py-2.5 pl-4 text-right tabular-nums">{cad(l.unitCents, lng)}</td>
                    <td className="whitespace-nowrap py-2.5 pl-4 text-right tabular-nums">{cad(l.amountCents, lng)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {i.status === 'DRAFT' ? (
          <button type="button" onClick={() => setLines((ls) => [...(ls ?? []), { description: '', quantity: '1', unit: '0.00' }])} className="mt-2 flex items-center gap-1.5 text-small font-semibold text-[#0D5F59] print:hidden">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('billing.addLine')}
          </button>
        ) : null}

        <dl className="ml-auto mt-6 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-small">
          <dt className="text-[#56696B]">{t('billing.subtotal')}</dt>
          <dd className="text-right tabular-nums">{cad(i.subtotalCents, lng)}</dd>
          {i.taxLines.map((x) => (
            <div key={x.name} className="contents">
              <dt className="text-[#56696B]">
                {x.name} ({x.rate.replace('.', lng === 'fr-CA' ? ',' : '.')} %)
              </dt>
              <dd className="text-right tabular-nums">{cad(x.amountCents, lng)}</dd>
            </div>
          ))}
          {i.billTo.taxExempt ? <dd className="col-span-2 text-caption text-[#56696B]">{t('billing.exempt', { note: i.billTo.taxExemptNote ?? '' })}</dd> : null}
          <dt className="border-t-2 border-[#0B1F22] pt-2 text-body-strong">{t('billing.total')}</dt>
          <dd className="border-t-2 border-[#0B1F22] pt-2 text-right text-body-strong tabular-nums">{cad(i.totalCents, lng)}</dd>
          {i.paidCents ? (
            <>
              <dt className="text-[#56696B]">{t('billing.paid')}</dt>
              <dd className="text-right tabular-nums">−{cad(i.paidCents, lng)}</dd>
              <dt className="font-semibold">{t('billing.balance')}</dt>
              <dd className="text-right font-semibold tabular-nums">{cad(i.balanceCents, lng)}</dd>
            </>
          ) : null}
        </dl>
        {i.status === 'DRAFT' && dirty ? <p className="mt-2 text-right text-caption text-[#56696B] print:hidden">{t('billing.saveToRecalculate')}</p> : null}

        <footer className="mt-10 grid gap-2 border-t border-[#D9E3E1] pt-4 text-caption text-[#56696B]">
          {i.notes ? <p className="text-small text-[#0B1F22]">{i.notes}</p> : null}
          <p>{i.issuer.remittance}</p>
          <p>
            {[i.issuer.gstNumber ? `${t('billing.gstNo')} ${i.issuer.gstNumber}` : null, i.issuer.qstNumber ? `${t('billing.qstNo')} ${i.issuer.qstNumber}` : null].filter(Boolean).join(' · ')}
          </p>
          {i.voidReason ? <p className="font-semibold">{t('billing.voidedBecause', { reason: i.voidReason })}</p> : null}
          {i.payments.length ? (
            <p>
              {t('billing.payments')}: {i.payments.map((p) => `${d(p.receivedOn)} ${cad(p.amountCents, lng)} (${t(`billing.methods.${p.method}`)}${p.reference ? ` ${p.reference}` : ''})`).join(' · ')}
            </p>
          ) : null}
        </footer>
      </article>

      <Dialog
        open={dialog === 'send'}
        onClose={() => setDialog(null)}
        title={t('billing.sendTitle')}
        description={t('billing.sendHelp', { email: i.billTo.email, total: cad(i.totalCents, lng) })}
        closeLabel={t('common.cancel')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={busy === 'send'} onClick={() => void act('send', () => papi(`/billing/invoices/${id}/send`, { method: 'POST' }), t('billing.sentToast'))}>
              {t('billing.send')}
            </Button>
          </>
        }
      />

      <Dialog open={dialog === 'pay'} onClose={() => setDialog(null)} title={t('billing.recordPayment')} description={t('billing.balanceIs', { amount: cad(i.balanceCents, lng) })} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = {
              amountCents: Math.round(Number(String(f.get('amount')).replace(',', '.')) * 100),
              receivedOn: String(f.get('on')),
              method: String(f.get('method')),
              reference: String(f.get('ref') ?? '').trim() || null,
            };
            void act('pay', () => papi(`/billing/invoices/${id}/payments`, { method: 'POST', body }), t('billing.paymentRecorded'));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('billing.amountReceived')}>{(p) => <Input {...p} name="amount" inputMode="decimal" required defaultValue={(i.balanceCents / 100).toFixed(2)} />}</Field>
            <Field label={t('billing.receivedOn')}>{(p) => <Input {...p} name="on" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
            <Field label={t('billing.method')}>
              {(p) => (
                <Select {...p} name="method" defaultValue="EFT">
                  {['EFT', 'CHEQUE', 'CARD', 'PAD', 'OTHER'].map((m) => (
                    <option key={m} value={m}>
                      {t(`billing.methods.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('billing.reference')} hint={t('common.optional')}>{(p) => <Input {...p} name="ref" placeholder="EFT 20261105-…" />}</Field>
          </div>
          <Button type="submit" loading={busy === 'pay'} icon={<Banknote className="h-4 w-4" aria-hidden="true" />}>
            {t('billing.recordPayment')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'credit' || dialog === 'writeoff'} onClose={() => setDialog(null)} title={dialog === 'writeoff' ? t('billing.writeOffTitle', { number: i.number }) : t('billing.creditTitle', { number: i.number })} description={dialog === 'writeoff' ? t('billing.writeOffHelp', { amount: cad(i.balanceCents, lng) }) : t('billing.creditHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = { reason: String(f.get('reason')).trim(), date: String(f.get('on')), ...(dialog === 'credit' ? { amountCents: Math.round(Number(String(f.get('amount')).replace(',', '.')) * 100) } : {}) };
            void act('adjust', () => papi(`/billing/invoices/${id}/${dialog === 'writeoff' ? 'write-off' : 'credit'}`, { method: 'POST', body }), dialog === 'writeoff' ? t('billing.writtenOff') : t('billing.credited'));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {dialog === 'credit' ? <Field label={t('billing.creditAmount')} hint={t('billing.inclTax')}>{(p) => <Input {...p} name="amount" inputMode="decimal" required defaultValue={(i.balanceCents / 100).toFixed(2)} />}</Field> : null}
            <Field label={t('billing.adjustDate')}>{(p) => <Input {...p} name="on" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
          </div>
          <Field label={t('billing.adjustReason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={120} />}</Field>
          <Button type="submit" variant={dialog === 'writeoff' ? 'danger' : 'primary'} loading={busy === 'adjust'}>{dialog === 'writeoff' ? t('billing.writeOff') : t('billing.credit')}</Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'void'} onClose={() => setDialog(null)} title={t('billing.voidTitle', { number: i.number })} description={t('billing.voidHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get('reason'));
            void act('void', () => papi(`/billing/invoices/${id}/void`, { method: 'POST', body: { reason } }), t('billing.voided'));
          }}
        >
          <Field label={t('billing.voidReason')}>{(p) => <Textarea {...p} name="reason" required minLength={3} maxLength={200} />}</Field>
          <Button type="submit" variant="danger" loading={busy === 'void'} icon={<Ban className="h-4 w-4" aria-hidden="true" />}>
            {t('billing.void')}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

export default function InvoicePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <Invoice />
    </Suspense>
  );
}
