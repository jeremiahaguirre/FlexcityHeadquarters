'use client';

import { FilePlus2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { type InvoiceRow, type TaxLine, cad, thisMonth } from '@/lib/billing';
import { papi, usePlatformQuery } from '@/lib/platform';
import { PROVINCES } from '@/lib/regions';
import { InvoiceList } from './InvoiceList';
import type { PanelProps } from './types';

interface Account {
  plan: 'MUNICIPAL' | 'CLUB';
  legalName: string;
  contactName: string | null;
  email: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string;
  postalCode: string | null;
  poNumber: string | null;
  paymentTermsDays: number;
  taxExempt: boolean;
  taxExemptNote: string | null;
  addOnHr: boolean;
  addOnOps: boolean;
  addOnUnion: boolean;
  trialEndsAt: string | null;
  graceDays: number;
  suspensionHoldUntil: string | null;
  preferredPayment: 'INVOICE' | 'CARD' | 'PAD';
  clubUserRateCents: number;
  notes: string | null;
}
interface Estimate { lines: Array<{ description: string; quantity: number; amountCents: number }>; subtotalCents: number; taxLines: TaxLine[]; totalCents: number; activeUsers: number }
interface BillingData { organization: { name: string }; account: Account | null; facilities: Array<{ id: string; name: string; province: string; tier: number | null; customCents: number | null }>; estimate: Estimate | null; state?: { stage: 'unbilled' | 'trial' | 'ok' | 'overdue' | 'suspended'; overdueCents: number; overdueSince: string | null; suspendsOn: string | null } }

const TIER_PRICE: Record<number, number> = { 1: 100_000, 2: 250_000, 3: 500_000 };

export function BillingPanel({ id, city }: PanelProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const data = usePlatformQuery<BillingData>(`/billing/accounts/${id}`);
  const invoices = usePlatformQuery<InvoiceRow[]>(`/billing/invoices?tenantId=${id}`);
  const [plan, setPlan] = useState<'MUNICIPAL' | 'CLUB' | null>(null);
  const [exempt, setExempt] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data.data) return <ListSkeleton rows={4} />;
  const a = data.data.account;
  const p = plan ?? a?.plan ?? 'MUNICIPAL';
  const isExempt = exempt ?? a?.taxExempt ?? false;
  const est = data.data.estimate;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const body = {
      plan: p,
      legalName: s('legalName'),
      contactName: s('contactName'),
      email: s('email'),
      addressLine1: s('address1'),
      addressLine2: s('address2'),
      city: s('city'),
      province: s('province'),
      postalCode: s('postal'),
      poNumber: s('po'),
      paymentTermsDays: Number(s('terms') ?? 30),
      taxExempt: isExempt,
      taxExemptNote: isExempt ? s('exemptNote') : null,
      addOnHr: f.get('hr') === 'on',
      addOnOps: f.get('ops') === 'on',
      addOnUnion: f.get('union') === 'on',
      trialEndsOn: s('trialEnds'),
      graceDays: Number(s('grace') ?? 30),
      suspensionHoldUntil: s('hold'),
      preferredPayment: s('preferred') ?? 'INVOICE',
      clubUserRateCents: Math.round(Number((s('clubRate') ?? '5').replace(',', '.')) * 100),
      notes: s('notes'),
      facilities: data.data!.facilities.map((x) => {
        const tier = s(`tier-${x.id}`);
        const custom = s(`custom-${x.id}`);
        return { id: x.id, tier: tier ? Number(tier) : null, customCents: custom ? Math.round(Number(custom.replace(',', '.')) * 100) : null };
      }),
    };
    setBusy('save');
    try {
      await papi(`/billing/accounts/${id}`, { method: 'PUT', body });
      toast(t('billing.accountSaved'), 'ok');
      await data.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    setBusy('draft');
    try {
      const r = await papi<Record<string, number>>('/billing/invoices/generate', { method: 'POST', body: { month: thisMonth(), tenantIds: [id] } });
      toast(r.created ? t('billing.drafted') : t('billing.alreadyDrafted'), r.created ? 'ok' : 'info');
      await invoices.reload();
    } catch {
      toast(t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6">
      {est ? (
        <Card>
          <CardHeader
            title={t('billing.thisMonth')}
            description={p === 'CLUB' ? t('billing.activeUsersNow', { count: est.activeUsers }) : undefined}
            action={<Button size="sm" icon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'draft'} onClick={() => void draft()}>{t('billing.draftThisMonth')}</Button>}
          />
          <CardBody className="pt-3">
            <ul className="divide-y divide-line text-small">
              {est.lines.map((l) => (
                <li key={l.description} className="flex justify-between gap-3 py-2">
                  <span>
                    {l.description}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                  </span>
                  <span className="tabular-nums">{cad(l.amountCents, lng)}</span>
                </li>
              ))}
              {est.taxLines.map((x) => (
                <li key={x.name} className="flex justify-between gap-3 py-2 text-muted">
                  <span>
                    {x.name} {x.rate} %
                  </span>
                  <span className="tabular-nums">{cad(x.amountCents, lng)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 py-2 text-body-strong">
                <span>{t('billing.total')}</span>
                <span className="tabular-nums">{cad(est.totalCents, lng)}</span>
              </li>
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t('billing.account')} description={a ? t('billing.accountHelp') : t('billing.accountNew', { name: city.organization.name })} />
        <CardBody className="pt-3">
          <form onSubmit={(e) => void save(e)} className="grid gap-5">
            <Segmented
              label={t('billing.plan')}
              value={p}
              onChange={setPlan}
              options={[
                { value: 'MUNICIPAL' as const, label: t('billing.plans.MUNICIPAL') },
                { value: 'CLUB' as const, label: t('billing.plans.CLUB') },
              ]}
            />
            {p === 'MUNICIPAL' ? (
              <fieldset className="grid gap-3 rounded-xl bg-surface p-4">
                <legend className="px-1 text-small font-semibold">{t('billing.facilityTiers')}</legend>
                {data.data.facilities.map((x) => (
                  <div key={x.id} className="grid items-end gap-3 sm:grid-cols-[1fr_14rem_9rem]">
                    <p className="text-small font-semibold sm:pb-3">{x.name}</p>
                    <Field label={t('billing.tier')}>
                      {(fp) => (
                        <Select {...fp} name={`tier-${x.id}`} defaultValue={x.tier ?? ''}>
                          <option value="">{t('billing.notBilled')}</option>
                          {[1, 2, 3].map((n) => (
                            <option key={n} value={n}>
                              {t(`billing.tiers.${n}`, { price: cad(TIER_PRICE[n]!, lng) })}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('billing.contractRate')} hint={t('common.optional')}>{(fp) => <Input {...fp} name={`custom-${x.id}`} inputMode="decimal" defaultValue={x.customCents !== null ? (x.customCents / 100).toFixed(2) : ''} />}</Field>
                  </div>
                ))}
              </fieldset>
            ) : (
              <div className="grid gap-2 rounded-xl bg-surface p-4">
                <p className="text-small">{t('billing.clubHelp')}</p>
                <div className="w-48">
                  <Field label={t('billing.clubRate')}>{(fp) => <Input {...fp} name="clubRate" inputMode="decimal" defaultValue={((a?.clubUserRateCents ?? 500) / 100).toFixed(2)} />}</Field>
                </div>
              </div>
            )}
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-small font-semibold">{t('billing.addOns')}</legend>
              <label className="flex items-center gap-2 text-small">
                <input type="checkbox" name="hr" defaultChecked={a?.addOnHr} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {t('billing.addOnHr')}
              </label>
              <label className="flex items-center gap-2 text-small">
                <input type="checkbox" name="ops" defaultChecked={a?.addOnOps} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {t('billing.addOnOps')}
              </label>
              <label className="flex items-center gap-2 text-small">
                <input type="checkbox" name="union" defaultChecked={a?.addOnUnion} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {t('billing.addOnUnion')}
              </label>
              <p className="text-caption text-muted">{t('billing.addOnsLock')}</p>
            </fieldset>
            <fieldset className="grid gap-3 rounded-2xl border border-line p-4">
              <legend className="px-1 text-small font-semibold">{t('billing.accessTitle')}</legend>
              {data.data?.state ? (
                <p className="text-small">
                  <StatusPill tone={({ unbilled: 'neutral', trial: 'brand', ok: 'ok', overdue: 'warn', suspended: 'danger' } as const)[data.data.state.stage]}>{t(`billing.stage.${data.data.state.stage}`)}</StatusPill>
                  {data.data.state.suspendsOn ? <span className="ml-2 text-muted">{t(data.data.state.stage === 'suspended' ? 'billing.suspendedSince' : 'billing.suspendsOn', { date: data.data.state.suspendsOn })}</span> : null}
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('billing.trialEnds')} hint={t('billing.trialEndsHint')}>{(fp) => <Input {...fp} name="trialEnds" type="date" defaultValue={a?.trialEndsAt?.slice(0, 10) ?? ''} />}</Field>
                <Field label={t('billing.grace')} hint={t('billing.graceHint')}>
                  {(fp) => (
                    <Select {...fp} name="grace" defaultValue={String(a?.graceDays ?? 30)}>
                      {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{t('billing.graceDays', { count: d })}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label={t('billing.hold')} hint={t('billing.holdHint')}>{(fp) => <Input {...fp} name="hold" type="date" defaultValue={a?.suspensionHoldUntil?.slice(0, 10) ?? ''} />}</Field>
                <Field label={t('billing.preferred')}>
                  {(fp) => (
                    <Select {...fp} name="preferred" defaultValue={a?.preferredPayment ?? 'INVOICE'}>
                      {(['INVOICE', 'CARD', 'PAD'] as const).map((m) => <option key={m} value={m}>{t(`billing.pay.${m}`)}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('billing.legalName')}>{(fp) => <Input {...fp} name="legalName" required defaultValue={a?.legalName ?? city.organization.name} />}</Field>
              <Field label={t('billing.contactName')}>{(fp) => <Input {...fp} name="contactName" defaultValue={a?.contactName ?? 'Accounts Payable'} />}</Field>
              <Field label={t('billing.email')} hint={t('billing.emailHint')}>{(fp) => <Input {...fp} name="email" type="email" required defaultValue={a?.email ?? ''} />}</Field>
              <Field label={t('billing.po')} hint={t('common.optional')}>{(fp) => <Input {...fp} name="po" defaultValue={a?.poNumber ?? ''} />}</Field>
              <Field label={t('billing.address1')}>{(fp) => <Input {...fp} name="address1" defaultValue={a?.addressLine1 ?? ''} />}</Field>
              <Field label={t('billing.address2')}>{(fp) => <Input {...fp} name="address2" defaultValue={a?.addressLine2 ?? ''} />}</Field>
              <Field label={t('billing.city')}>{(fp) => <Input {...fp} name="city" defaultValue={a?.city ?? ''} />}</Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('settings.province')} hint={t('billing.provinceHint')}>
                  {(fp) => (
                    <Select {...fp} name="province" defaultValue={a?.province ?? data.data!.facilities[0]?.province ?? 'BC'}>
                      {PROVINCES.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('billing.postal')}>{(fp) => <Input {...fp} name="postal" defaultValue={a?.postalCode ?? ''} />}</Field>
              </div>
              <Field label={t('billing.terms')}>
                {(fp) => (
                  <Select {...fp} name="terms" defaultValue={String(a?.paymentTermsDays ?? 30)}>
                    {[0, 15, 30, 45, 60].map((d) => (
                      <option key={d} value={d}>
                        {d ? t('billing.netDays', { days: d }) : t('billing.onReceipt')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <label className="flex items-center gap-2 text-small font-semibold">
              <input type="checkbox" checked={isExempt} onChange={(e) => setExempt(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
              {t('billing.taxExempt')}
            </label>
            {isExempt ? <Field label={t('billing.exemptNote')} hint={t('billing.exemptNoteHint')}>{(fp) => <Input {...fp} name="exemptNote" required defaultValue={a?.taxExemptNote ?? ''} />}</Field> : null}
            <Field label={t('billing.internalNotes')} hint={t('billing.internalNotesHint')}>{(fp) => <Textarea {...fp} name="notes" defaultValue={a?.notes ?? ''} />}</Field>
            <Button type="submit" className="justify-self-start" loading={busy === 'save'}>
              {t('common.save')}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('billing.invoices')} />
        <CardBody className="pt-3">{invoices.data ? <InvoiceList invoices={invoices.data} showOrg={false} /> : <ListSkeleton rows={2} />}</CardBody>
      </Card>
    </div>
  );
}
