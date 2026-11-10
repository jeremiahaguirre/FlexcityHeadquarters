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
import { type Catalog, MODULES, type Module, PLAN_LEVELS, type PlanLevel, cents } from '@/lib/plans';
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
  level: PlanLevel;
  quotedRateCents: number | null;
  includedStaff: number | null;
  extraStaffSeats: number;
  modules: Module[];
  trialEndsAt: string | null;
  graceDays: number;
  suspensionHoldUntil: string | null;
  preferredPayment: 'INVOICE' | 'CARD' | 'PAD';
  clubUserRateCents: number;
  notes: string | null;
}
export interface StaffUsage { active: number; included: number | null; seats: number; unlimited: boolean; over: number; rateCents: number }
interface Estimate { lines: Array<{ description: string; quantity: number; amountCents: number }>; subtotalCents: number; taxLines: TaxLine[]; totalCents: number; activeUsers: number; staff: StaffUsage }
interface BillingData { catalog: Catalog; organization: { name: string }; account: Account | null; facilities: Array<{ id: string; name: string; province: string; tier: number | null; customCents: number | null }>; estimate: Estimate | null; state?: { stage: 'unbilled' | 'trial' | 'ok' | 'overdue' | 'suspended'; overdueCents: number; overdueSince: string | null; suspendsOn: string | null } }


export function BillingPanel({ id, city }: PanelProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const data = usePlatformQuery<BillingData>(`/billing/accounts/${id}`);
  const invoices = usePlatformQuery<InvoiceRow[]>(`/billing/invoices?tenantId=${id}`);
  const [plan, setPlan] = useState<'MUNICIPAL' | 'CLUB' | null>(null);
  const [level, setLevel] = useState<PlanLevel | null>(null);
  const [mods, setMods] = useState<Module[] | null>(null);
  const [exempt, setExempt] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data.data) return <ListSkeleton rows={4} />;
  const a = data.data.account;
  const p = plan ?? a?.plan ?? 'MUNICIPAL';
  const isExempt = exempt ?? a?.taxExempt ?? false;
  const cat = data.data.catalog;
  const lv = level ?? a?.level ?? 'BUSINESS';
  const chosen = cat.public[lv];
  const money = (c: number) => cents(c, lng, false);
  const savedMods = a?.plan === 'CLUB' ? a.modules : [];
  const picked = mods ?? savedMods;
  const toggle = (m: Module) => setMods(picked.includes(m) ? picked.filter((x) => x !== m) : [...picked, m]);
  const trialOn = data.data.state?.stage === 'trial';
  const userRate = a?.clubUserRateCents ?? cat.private.userCents;
  const seats = a?.extraStaffSeats ?? 0;
  const privateMonthly = cat.private.coreCents + (seats + Math.max(0, (data.data.estimate?.activeUsers ?? 0) - cat.private.includedUsers - seats)) * userRate + picked.reduce((n, m) => n + cat.modules[m].privateCents, 0);
  const dollars = (v: string | null) => (v ? Math.round(Number(v.replace(',', '.')) * 100) : null);
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
      level: lv,
      quotedRateCents: chosen.quoted ? dollars(s('quotedRate')) : null,
      includedStaff: chosen.quoted && chosen.staffPerFacility !== null && s('includedStaff') ? Number(s('includedStaff')) : null,
      extraStaffSeats: Number(s('seats') ?? 0) || 0,
      modules: p === 'CLUB' ? picked : MODULES.filter((m) => f.get(`module-${m}`) === 'on'),
      trialEndsOn: s('trialEnds'),
      graceDays: Number(s('grace') ?? 30),
      suspensionHoldUntil: s('hold'),
      preferredPayment: s('preferred') ?? 'INVOICE',
      clubUserRateCents: Math.round(Number((s('clubRate') ?? '5').replace(',', '.')) * 100),
      notes: s('notes'),
      facilities: data.data!.facilities.map((x) => {
        const tier = s(`tier-${x.id}`);
        const custom = s(`custom-${x.id}`);
        return { id: x.id, tier: tier ? Number(tier) : null, customCents: dollars(custom) };
      }),
    };
    setBusy('save');
    try {
      await papi(`/billing/accounts/${id}`, { method: 'PUT', body });
      toast(t('billing.accountSaved'), 'ok');
      await data.reload();
      setMods(null);
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
            description={t('billing.activeUsersNow', { count: est.activeUsers })}
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
                { value: 'MUNICIPAL' as const, label: t('plans.sector.MUNICIPAL') },
                { value: 'CLUB' as const, label: t('plans.sector.CLUB') },
              ]}
            />
            {p === 'MUNICIPAL' ? (
              <>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-small font-semibold">{t('billing.chooseLevel')}</legend>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {PLAN_LEVELS.map((l) => {
                      const pl = cat.public[l];
                      return (
                        <label key={l} className={`grid cursor-pointer gap-1 rounded-xl border p-3 text-small ${lv === l ? 'border-brand bg-brand/5' : 'border-line'}`}>
                          <span className="flex items-center gap-2 font-semibold">
                            <input type="radio" name="level" value={l} checked={lv === l} onChange={() => setLevel(l)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                            {t(`plans.level.${l}`)}
                          </span>
                          <span className="tabular-nums">{t(pl.quoted ? 'plans.listFrom' : 'plans.perFacility', { price: cents(pl.listCents, lng) })}</span>
                          <span className="text-caption text-muted">{pl.staffPerFacility === null ? t('plans.staffUnlimited') : `${t('plans.staffIncluded', { count: pl.staffPerFacility })} · ${t('plans.extraStaff', { price: money(pl.extraStaffCents) })}`}</span>
                          <span className="text-caption text-muted">{t(`plans.levelFor.${l}`)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {chosen.quoted ? (
                  <div className="grid gap-4 rounded-xl bg-surface p-4 sm:grid-cols-2">
                    <Field label={t('billing.quotedRate')} hint={t('billing.quotedRateHint', { price: cents(chosen.listCents, lng) })}>
                      {(fp) => <Input {...fp} key={`q-${lv}`} name="quotedRate" inputMode="decimal" placeholder={(chosen.listCents / 100).toFixed(2)} defaultValue={a?.level === lv && a.quotedRateCents !== null ? (a.quotedRateCents / 100).toFixed(2) : ''} />}
                    </Field>
                    {chosen.staffPerFacility !== null ? (
                      <Field label={t('billing.includedStaff')} hint={t('billing.includedStaffHint', { count: chosen.staffPerFacility })}>
                        {(fp) => <Input {...fp} key={`s-${lv}`} name="includedStaff" inputMode="numeric" defaultValue={a?.level === lv && a.includedStaff !== null ? String(a.includedStaff) : ''} />}
                      </Field>
                    ) : null}
                  </div>
                ) : null}
                <fieldset className="grid gap-3 rounded-xl bg-surface p-4">
                  <legend className="px-1 text-small font-semibold">{t('billing.facilitySizes')}</legend>
                  {data.data.facilities.map((x) => (
                    <div key={x.id} className="grid items-end gap-3 sm:grid-cols-[1fr_16rem_9rem]">
                      <p className="text-small font-semibold sm:pb-3">{x.name}</p>
                      <Field label={t('billing.size')}>
                        {(fp) => (
                          <Select {...fp} name={`tier-${x.id}`} defaultValue={x.tier ?? ''}>
                            <option value="">{t('billing.notBilled')}</option>
                            {[1, 2, 3].map((n) => (
                              <option key={n} value={n}>
                                {t(`plans.size.${n}`)} ({cents(Math.round(((chosen.quoted && a?.level === lv && a.quotedRateCents !== null ? a.quotedRateCents : chosen.listCents) * (cat.sizePercent[n] ?? 100)) / 100), lng)})
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label={t('billing.contractRate')} hint={t('common.optional')}>{(fp) => <Input {...fp} name={`custom-${x.id}`} inputMode="decimal" defaultValue={x.customCents !== null ? (x.customCents / 100).toFixed(2) : ''} />}</Field>
                    </div>
                  ))}
                </fieldset>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-small font-semibold">{t('billing.included')}</legend>
                  <ul className="grid gap-1 text-small">
                    <li>✓ {t('plans.core')}</li>
                    {chosen.modules.map((m) => <li key={m}>✓ {t(`plans.module.${m}`)}</li>)}
                    {chosen.service.map((x) => <li key={x} className="text-muted">✓ {t(`plans.service.${x}`)}</li>)}
                  </ul>
                  {(Object.keys(cat.publicExtras) as Module[]).filter((m) => !chosen.modules.includes(m)).map((m) => (
                    <label key={m} className="mt-1 flex items-center gap-2 text-small">
                      <input type="checkbox" name={`module-${m}`} defaultChecked={a?.modules.includes(m)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                      {t(`plans.module.${m}`)} (+{t('plans.perMonth', { price: cents(cat.publicExtras[m]!, lng) })})
                    </label>
                  ))}
                </fieldset>
              </>
            ) : (
              <>
                <div className="grid gap-2 rounded-xl bg-surface p-4">
                  <p className="text-small">{t('plans.privateCore', { price: cents(cat.private.coreCents, lng), count: cat.private.includedUsers, each: money(cat.private.userCents) })}</p>
                  <div className="w-48">
                    <Field label={t('billing.clubRate')}>{(fp) => <Input {...fp} name="clubRate" inputMode="decimal" defaultValue={((a?.clubUserRateCents ?? cat.private.userCents) / 100).toFixed(2)} />}</Field>
                  </div>
                </div>
                <fieldset className="grid gap-3">
                  <legend className="mb-1 text-small font-semibold">{t('billing.modulesTitle')}</legend>
                  <p className="text-caption text-muted">{trialOn ? t('billing.modulesTrial') : t('billing.modulesHelp')}</p>
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {MODULES.map((m) => {
                      const on = picked.includes(m);
                      const live = savedMods.includes(m);
                      return (
                        <li key={m} className="flex items-start gap-3 px-4 py-3">
                          <button type="button" role="switch" aria-checked={on} aria-label={t(`plans.module.${m}`)} onClick={() => toggle(m)} className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-brand' : 'bg-line'}`}>
                            <span className={`h-5 w-5 rounded-full bg-panel shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
                          </button>
                          <span className="min-w-0 flex-1 text-small">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{t(`plans.module.${m}`)}</span>
                              <span className="tabular-nums text-muted">{t('plans.perMonth', { price: cents(cat.modules[m].privateCents, lng) })}</span>
                              {on !== live ? <StatusPill tone="warn">{on ? t('billing.willTurnOn') : t('billing.willTurnOff')}</StatusPill> : live ? <StatusPill tone="ok">{t('billing.liveNow')}</StatusPill> : null}
                            </span>
                            <span className="block text-caption text-muted">{t(`plans.moduleIncludes.${m}`)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface px-4 py-3 text-small">
                    <span>{t('billing.privateMonthly', { count: picked.length })}</span>
                    <span className="text-body-strong tabular-nums">{t('plans.perMonth', { price: cents(privateMonthly, lng, false) })}</span>
                  </p>
                </fieldset>
              </>
            )}
            <p className="text-caption text-muted">{t('billing.addOnsLock')}</p>
            {p === 'CLUB' || chosen.staffPerFacility !== null ? (
              <fieldset className="grid gap-3 rounded-2xl border border-line p-4">
                <legend className="px-1 text-small font-semibold">{t('billing.staffTitle')}</legend>
                {est ? <StaffMeter staff={est.staff} lng={lng} /> : null}
                <div className="grid items-end gap-3 sm:grid-cols-[12rem_1fr]">
                  <Field label={t('billing.seats')}>{(fp) => <Input {...fp} name="seats" type="number" min={0} step={5} inputMode="numeric" defaultValue={String(a?.extraStaffSeats ?? 0)} />}</Field>
                  <p className="text-caption text-muted sm:pb-3">{t('billing.seatsHint', { price: money(p === 'CLUB' ? (a?.clubUserRateCents ?? cat.private.userCents) : chosen.extraStaffCents) })}</p>
                </div>
              </fieldset>
            ) : null}
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

/** Active staff this month against what the plan includes, places added, and anyone over (billed to the organization). */
export function StaffMeter({ staff, lng }: { staff: StaffUsage; lng: string }) {
  const { t } = useTranslation();
  if (staff.unlimited) return <p className="text-small">{t('billing.staffUnlimited', { count: staff.active })}</p>;
  const cap = (staff.included ?? 0) + staff.seats;
  const pct = cap ? Math.min(100, Math.round((staff.active / cap) * 100)) : 100;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-small">
        <span>{t('billing.staffUsed', { active: staff.active, cap })}</span>
        <span className="text-caption text-muted">{t('billing.staffParts', { included: staff.included ?? 0, seats: staff.seats })}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={t('billing.staffUsed', { active: staff.active, cap })}>
        <div className={`h-full ${staff.over ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
      {staff.over ? <p className="text-small text-warn">{t('billing.staffOver', { count: staff.over, amount: cents(staff.over * staff.rateCents, lng, false) })}</p> : null}
    </div>
  );
}
