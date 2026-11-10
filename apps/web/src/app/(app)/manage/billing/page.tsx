'use client';

import { Building2, Check, CreditCard, FileText, Landmark, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { AutoDebitCard } from '@/components/billing/AutoDebitCard';
import { api } from '@/lib/api';
import type { PadAgreement } from '@/lib/books';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';
import { StaffMeter, type StaffUsage } from '@/components/platform/BillingPanel';
import { type Catalog, GROUPS, type ItemKey, type ItemState, type PlanLevel, cents } from '@/lib/plans';

interface InvoiceRow { id: string; number: string | null; status: string; periodStart: string; periodEnd: string; issueDate: string | null; dueDate: string | null; totalCents: number; paidCents: number; balanceCents: number }
interface InvoiceDetail extends InvoiceRow { subtotalCents: number; taxLines: Array<{ name: string; rate: string; amountCents: number }>; lines: Array<{ description: string; quantity: number; amountCents: number }>; payments: Array<{ amountCents: number; receivedOn: string; method: string }>; poNumber: string | null }
interface Billing {
  state: { stage: 'unbilled' | 'trial' | 'ok' | 'overdue' | 'suspended'; balanceCents: number; overdueCents: number; overdueSince: string | null; suspendsOn: string | null; trialEndsAt: string | null };
  plan: { legalName?: string; plan: 'MUNICIPAL' | 'CLUB'; level: PlanLevel; rateCents: number | null; items: ItemState[]; paymentTermsDays: number; preferredPayment: string; poNumber: string | null } | null;
  catalog: Catalog;
  staff: StaffUsage | null;
  invoices: InvoiceRow[];
  payment: { online: boolean; remittance: string; payee: string; contact: string };
  pad?: { agreement: PadAgreement | null; terms: string[] };
}

const STATUS_TONE: Record<string, Tone> = { SENT: 'new', PARTIAL: 'warn', OVERDUE: 'danger', PAID: 'ok', VOID: 'neutral' };
const STAGE_TONE: Record<Billing['state']['stage'], Tone> = { unbilled: 'neutral', trial: 'brand', ok: 'ok', overdue: 'warn', suspended: 'danger' };

/** The organization's plan, its invoices, and paying them by card, bank debit, EFT or cheque. */
export default function BillingPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { reload } = useSession();
  const q = useQuery<Billing>(`/api/billing?lang=${i18n.language}`);
  const { run, busy } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery<InvoiceDetail>(open ? `/api/billing/invoices/${open}` : null);
  const [unlock, setUnlock] = useState<ItemKey | null>(null);
  const money = (c: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(c / 100);
  const date = (d: string | null) => (d ? dateFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) : '—');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('paid')) {
      toast(t('billingPage.thanks'), 'ok');
      // Card payments land within seconds; give the webhook a moment, then refresh access.
      setTimeout(() => void q.reload().then(reload), 4000);
    }
    if (p.get('cancelled')) toast(t('billingPage.cancelled'), 'warn');
    const u = p.get('unlock');
    if (u) setUnlock(u as ItemKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pay(id: string, method: 'card' | 'pad') {
    const r = await run(`${method}${id}`, () => api<{ url: string }>(`/api/billing/invoices/${id}/checkout`, { method: 'POST', body: { method } }));
    if (r?.url) window.location.assign(r.url);
  }

  const b = q.data;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('billingPage.title')} description={t('billingPage.description')} />
      {!b ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <Card>
              <CardHeader title={t('billingPage.plan')} />
              <CardBody className="grid gap-4 pt-2 text-small">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={STAGE_TONE[b.state.stage]}>{t(`billingPage.stage.${b.state.stage}`)}</StatusPill>
                  {b.plan ? <span className="font-semibold">{b.plan.plan === 'MUNICIPAL' ? `${t('plans.sector.MUNICIPAL')} · ${t(`plans.level.${b.plan.level}`)}` : t('plans.sector.CLUB')}</span> : null}
                </div>
                {b.plan?.plan === 'MUNICIPAL' && b.plan.rateCents !== null ? (
                  <p className="text-caption text-muted">
                    {t('billingPage.rate', { price: cents(b.plan.rateCents, i18n.language) })} ·{' '}
                    {(() => {
                      const pl = b.catalog.public[b.plan.level];
                      return pl.staffPerFacility === null ? t('plans.staffUnlimited') : `${t('plans.staffIncluded', { count: pl.staffPerFacility })}, ${t('plans.extraStaff', { price: cents(pl.extraStaffCents, i18n.language, false) })}`;
                    })()}
                  </p>
                ) : null}
                {b.staff ? (
                  <div className="rounded-xl bg-surface p-3">
                    <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">{t('billing.staffTitle')}</p>
                    <StaffMeter staff={b.staff} lng={i18n.language} />
                    {b.staff.unlimited ? null : <p className="mt-2 text-caption text-muted">{t('billingPage.addStaff', { contact: b.payment.contact })}</p>}
                  </div>
                ) : null}
                {b.state.trialEndsAt ? <p>{t('billingPage.trialUntil', { date: date(b.state.trialEndsAt.slice(0, 10)) })}</p> : null}
                {b.state.stage === 'overdue' ? <p className="font-semibold text-warn">{t('billingPage.overdue', { since: date(b.state.overdueSince), date: date(b.state.suspendsOn) })}</p> : null}
                {b.state.stage === 'suspended' ? <p className="font-semibold text-danger">{t('billingPage.suspendedPay')}</p> : null}
                <ul className="grid gap-3">
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                    <span><span className="font-semibold">{t('plans.core')}</span><span className="block text-caption text-muted">{t('plans.coreIncludes')}</span></span>
                  </li>
                  {GROUPS.map((g) => {
                    const list = (Object.keys(b.catalog.items) as ItemKey[]).filter((k) => b.catalog.items[k].group === g);
                    return (
                      <li key={g} className="grid gap-2">
                        <p className="text-caption font-semibold uppercase tracking-wide text-muted">{t(`plans.group.${g}`)}</p>
                        <ul className="grid gap-2">
                          {list.map((k) => {
                            const owned = !b.plan || b.state.stage === 'trial' || !!b.plan.items.find((i) => i.key === k)?.on;
                            return (
                              <li key={k} className={`flex gap-2 rounded-xl ${unlock === k ? 'bg-brand/10 p-2' : ''}`}>
                                {owned ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                                <span>
                                  <span className={owned ? 'font-semibold' : 'font-semibold text-muted'}>{t(`plans.item.${k}`)}</span>
                                  {owned ? null : <span className="ml-2 text-caption text-muted">{t('billingPage.notIncluded')}</span>}
                                  <span className="block text-caption text-muted">{t(`plans.itemIncludes.${k}`)}</span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-caption text-muted">{t('billingPage.changePlan', { contact: b.payment.contact })}</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('billingPage.howToPay')} description={b.state.balanceCents ? t('billingPage.balance', { amount: money(b.state.balanceCents) }) : t('billingPage.nothingOwing')} />
              <CardBody className="grid gap-4 pt-2 text-small">
                <div className="flex gap-3">
                  <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
                  <p><span className="font-semibold">{t('billingPage.card')}</span><span className="block text-muted">{b.payment.online ? t('billingPage.cardHelp') : t('billingPage.onlineOff')}</span></p>
                </div>
                <div className="flex gap-3">
                  <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
                  <p><span className="font-semibold">{t('billingPage.pad')}</span><span className="block text-muted">{b.pad?.agreement ? t('pad.onFile', { account: b.pad.agreement.account }) : b.payment.online ? t('billingPage.padHelp') : t('pad.offerSetUp')}</span></p>
                </div>
                <div className="flex gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
                  <p><span className="font-semibold">{t('billingPage.direct')}</span><span className="block text-muted">{b.payment.remittance}</span><span className="block text-caption text-muted">{t('billingPage.payee', { name: b.payment.payee })}</span></p>
                </div>
              </CardBody>
            </Card>
          </div>
          {b.plan && b.pad ? <AutoDebitCard pad={b.pad} payor={b.plan.legalName ?? ''} reload={q.reload} /> : null}
          <Card>
            <CardHeader title={t('billingPage.invoices')} />
            <CardBody className="pt-2">
              {!b.invoices.length ? (
                <EmptyState icon={FileText} title={t('billingPage.noInvoices')}>{t('billingPage.noInvoicesHelp')}</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-small">
                    <thead className="text-left text-caption text-muted">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">{t('billingPage.number')}</th>
                        <th className="py-2 pr-3 font-semibold">{t('billingPage.period')}</th>
                        <th className="py-2 pr-3 font-semibold">{t('billingPage.due')}</th>
                        <th className="py-2 pr-3 text-right font-semibold">{t('billingPage.total')}</th>
                        <th className="py-2 pr-3 text-right font-semibold">{t('billingPage.owing')}</th>
                        <th className="py-2 pr-3 font-semibold">{t('billingPage.status')}</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {b.invoices.map((i) => (
                        <tr key={i.id}>
                          <td className="py-3 pr-3"><button type="button" className="font-semibold text-brand-text hover:underline" onClick={() => setOpen(i.id)}>{i.number}</button></td>
                          <td className="py-3 pr-3">{date(i.periodStart)} – {date(i.periodEnd)}</td>
                          <td className="py-3 pr-3">{date(i.dueDate)}</td>
                          <td className="py-3 pr-3 text-right tabular-nums">{money(i.totalCents)}</td>
                          <td className="py-3 pr-3 text-right font-semibold tabular-nums">{money(i.balanceCents)}</td>
                          <td className="py-3 pr-3"><StatusPill tone={STATUS_TONE[i.status] ?? 'neutral'}>{t(`billingPage.invoiceStatus.${i.status}`)}</StatusPill></td>
                          <td className="py-3">
                            {i.balanceCents > 0 && b.payment.online ? (
                              <div className="flex justify-end gap-2">
                                <Button size="sm" loading={busy === `card${i.id}`} icon={<CreditCard className="h-4 w-4" aria-hidden="true" />} onClick={() => void pay(i.id, 'card')}>{t('billingPage.payCard')}</Button>
                                <Button size="sm" variant="secondary" loading={busy === `pad${i.id}`} onClick={() => void pay(i.id, 'pad')}>{t('billingPage.payPad')}</Button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={detail.data?.number ? t('billingPage.invoiceTitle', { number: detail.data.number }) : t('billingPage.invoices')} closeLabel={t('common.close')}>
        {!detail.data ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-3 text-small">
            <p className="text-muted">{date(detail.data.periodStart)} – {date(detail.data.periodEnd)}{detail.data.poNumber ? ` · PO ${detail.data.poNumber}` : ''}</p>
            <ul className="divide-y divide-line">
              {detail.data.lines.map((l, n) => (
                <li key={n} className="flex justify-between gap-3 py-2"><span>{l.description}</span><span className="tabular-nums">{money(l.amountCents)}</span></li>
              ))}
              {detail.data.taxLines.map((x) => (
                <li key={x.name} className="flex justify-between gap-3 py-2 text-muted"><span>{x.name} ({x.rate} %)</span><span className="tabular-nums">{money(x.amountCents)}</span></li>
              ))}
              <li className="flex justify-between gap-3 py-2 font-semibold"><span>{t('billingPage.total')}</span><span className="tabular-nums">{money(detail.data.totalCents)}</span></li>
              {detail.data.payments.map((p, n) => (
                <li key={`p${n}`} className="flex justify-between gap-3 py-2 text-ok"><span>{t('billingPage.paid', { date: date(p.receivedOn), method: t(`billing.methods.${p.method}`, { defaultValue: p.method }) })}</span><span className="tabular-nums">−{money(p.amountCents)}</span></li>
              ))}
              <li className="flex justify-between gap-3 py-2 font-semibold"><span>{t('billingPage.owing')}</span><span className="tabular-nums">{money(detail.data.balanceCents)}</span></li>
            </ul>
          </div>
        )}
      </Dialog>
    </div>
  );
}
