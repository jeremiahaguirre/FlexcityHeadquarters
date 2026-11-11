'use client';

import { RenewalTerms } from '@/components/billing/RenewalTerms';
import { Building2, FilePlus2, RotateCcw, Users } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
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
import { cn } from '@/lib/cn';
import { papi, usePlatformQuery } from '@/lib/platform';
import { PROVINCES } from '@/lib/regions';
import { InvoiceList } from './InvoiceList';
import { type Catalog, type Cycle, GROUPS, TERM_CHOICES, type ItemKey, standardDiscount, type ItemState, PLAN_LEVELS, type PlanLevel, cents } from '@/lib/plans';
import type { PanelProps } from './types';

type Sector = 'MUNICIPAL' | 'CLUB';
interface Account {
  plan: Sector;
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
  billingCycle: Cycle;
  termMonths: number | null;
  termStart: string | null;
  discountPercent: string | number | null;
  trialEndsAt: string | null;
  graceDays: number;
  suspensionHoldUntil: string | null;
  preferredPayment: 'INVOICE' | 'CARD' | 'PAD';
  clubUserRateCents: number;
  notes: string | null;
}
export interface StaffUsage { active: number; included: number | null; seats: number; unlimited: boolean; over: number; rateCents: number }
interface Estimate { lines: Array<{ description: string; quantity: number; amountCents: number }>; subtotalCents: number; taxLines: TaxLine[]; totalCents: number; activeUsers: number; staff: StaffUsage; prepaidMonths: number }
interface Facility { id: string; name: string; province: string; tier: number | null; customCents: number | null }
interface BillingData { catalog: Catalog; organization: { name: string }; account: Account | null; items: ItemState[] | null; facilities: Facility[]; estimate: Estimate | null; state?: { stage: 'unbilled' | 'trial' | 'ok' | 'overdue' | 'suspended'; overdueCents: number; overdueSince: string | null; suspendsOn: string | null } }

/** "39.00" ↔ 3900. Empty means "use the standard". */
const toCents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v.replace(/[$\s]/g, '').replace(',', '.')) * 100));
const toDollars = (c: number) => (c / 100).toFixed(2);
const validCents = (c: number | null) => c !== null && Number.isFinite(c) && c >= 0;

/** A numbered part of the billing form. */
function Part({ n, title, hint, children, aside }: { n: number; title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-6 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-caption font-bold text-brand-text">{n}</span>
          <div>
            <h3 className="text-body-strong">{title}</h3>
            {hint ? <p className="mt-0.5 max-w-2xl text-caption text-muted">{hint}</p> : null}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} className={cn('inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand', on ? 'bg-brand' : 'bg-line')}>
      <span className={cn('h-5 w-5 rounded-full bg-panel shadow transition-transform', on && 'translate-x-5')} />
    </button>
  );
}

export function BillingPanel({ id, city }: PanelProps) {
  const data = usePlatformQuery<BillingData>(`/billing/accounts/${id}`);
  const invoices = usePlatformQuery<InvoiceRow[]>(`/billing/invoices?tenantId=${id}`);
  const [version, setVersion] = useState(0);
  if (!data.data) return <ListSkeleton rows={4} />;
  // Remounted after each save, so every field starts from what's stored.
  return <AccountEditor key={version} id={id} city={city} d={data.data} invoices={invoices} reload={async () => { await data.reload(); setVersion((v) => v + 1); }} />;
}

function AccountEditor({ id, city, d, invoices, reload }: { id: string; city: PanelProps['city']; d: BillingData; invoices: ReturnType<typeof usePlatformQuery<InvoiceRow[]>>; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const a = d.account;
  const cat = d.catalog;
  const est = d.estimate;
  const [p, setP] = useState<Sector>(a?.plan ?? 'MUNICIPAL');
  const [lv, setLv] = useState<PlanLevel>(a?.level ?? 'BUSINESS');
  const chosen = cat.public[lv];
  const [quoted, setQuoted] = useState(toDollars(a?.quotedRateCents ?? cat.public[a?.level ?? 'BUSINESS'].listCents));
  const [staffQuote, setStaffQuote] = useState(a?.includedStaff != null ? String(a.includedStaff) : '');
  const [seatsText, setSeatsText] = useState(String(a?.extraStaffSeats ?? 0));
  const [cycle, setCycle] = useState<Cycle>(a?.billingCycle ?? 'MONTHLY');
  const [termText, setTermText] = useState(a?.termMonths ? String(a.termMonths) : '');
  const [startMonth, setStartMonth] = useState(a?.termStart ? a.termStart.slice(0, 7) : '');
  // Null: the standard discount for the term (shown filled in); a string once changed.
  const [discountText, setDiscountText] = useState<string | null>(a?.discountPercent != null ? String(Number(a.discountPercent)) : null);
  const [userRate, setUserRate] = useState(toDollars(a?.clubUserRateCents ?? cat.private.userCents));
  const [fac, setFac] = useState(() => Object.fromEntries(d.facilities.map((f) => [f.id, { tier: f.tier, custom: f.customCents !== null ? toDollars(f.customCents) : '' }])));
  // Each option: an explicit on/off (else the plan's standard) and its price text (else the standard price).
  const saved = new Map((d.items ?? []).map((i) => [i.key, i]));
  const [choice, setChoice] = useState<Partial<Record<ItemKey, { on?: boolean; price?: string }>>>(() =>
    Object.fromEntries((d.items ?? []).map((i) => [i.key, { ...(i.on !== i.standard ? { on: i.on } : {}), ...(i.customPrice ? { price: toDollars(i.cents) } : {}) }])),
  );
  const [exempt, setExempt] = useState(a?.taxExempt ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const isExempt = exempt;
  const money = (c: number) => cents(c, lng, false);

  const stdOf = (k: ItemKey) => p === 'MUNICIPAL' && chosen.items.includes(k);
  const stdPrice = (k: ItemKey) => (p === 'CLUB' ? cat.items[k].privateCents : cat.items[k].publicCents);
  const rows = (Object.keys(cat.items) as ItemKey[]).map((k) => {
    const c = choice[k] ?? {};
    const standard = stdOf(k);
    const on = c.on ?? standard;
    const typed = c.price !== undefined ? toCents(c.price) : null;
    const price = validCents(typed) ? typed! : stdPrice(k);
    const effect = on && !standard ? price : !on && standard ? -price : 0;
    const was = saved.get(k);
    // Compared with what's stored: on in their app now, and whether saving changes it.
    const liveOn = a ? (was?.on ?? false) && (a.plan === p) : false;
    return { k, standard, on, price, custom: c.price !== undefined && typed !== stdPrice(k), effect, liveOn, changes: on !== liveOn };
  });
  const setOn = (k: ItemKey, on: boolean) => setChoice((x) => ({ ...x, [k]: { ...x[k], on } }));
  const setPrice = (k: ItemKey, price: string | undefined) => setChoice((x) => ({ ...x, [k]: { ...x[k], price } }));

  // A live estimate of the month, before tax, from everything on screen.
  const active = est?.activeUsers ?? 0;
  const seats = Math.max(0, Number(seatsText) || 0);
  const rate = chosen.quoted && validCents(toCents(quoted)) ? toCents(quoted)! : chosen.listCents;
  const facLines = d.facilities.map((f) => {
    const x = fac[f.id]!;
    const custom = toCents(x.custom);
    if (validCents(custom)) return custom!;
    return x.tier ? Math.round((rate * (cat.sizePercent[x.tier] ?? 100)) / 100) : 0;
  });
  const billed = d.facilities.filter((f) => fac[f.id]!.tier || validCents(toCents(fac[f.id]!.custom)));
  const allowance =
    p === 'CLUB' ? cat.private.includedUsers : chosen.staffPerFacility === null ? null : chosen.quoted && staffQuote.trim() ? Number(staffQuote) || 0 : billed.reduce((n, f) => n + Math.round(((chosen.staffPerFacility ?? 0) * (cat.sizePercent[fac[f.id]!.tier ?? 2] ?? 100)) / 100), 0);
  const perPerson = p === 'CLUB' ? toCents(userRate) ?? cat.private.userCents : chosen.extraStaffCents;
  const staffCents = allowance === null ? 0 : (seats + Math.max(0, active - allowance - seats)) * perPerson;
  const optionsCents = rows.reduce((n, r) => n + (p === 'CLUB' ? (r.on ? r.price : 0) : r.effect), 0);
  const monthly = (p === 'CLUB' ? cat.private.coreCents : facLines.reduce((n, c) => n + c, 0)) + staffCents + optionsCents;
  // Billing terms: usage (active staff beyond the plan) is monthly and never discounted.
  const overageCents = allowance === null ? 0 : Math.max(0, active - allowance - seats) * perPerson;
  const fixedCents = monthly - overageCents;
  const termMonths = termText.trim() ? Math.max(1, Math.min(120, Number(termText) || 0)) || null : null;
  const stdDiscount = standardDiscount(cycle, termMonths);
  const discount = discountText === null ? stdDiscount : Math.max(0, Math.min(50, Number(discountText.replace(',', '.')) || 0));
  const hasStart = !!startMonth;
  const effDiscount = hasStart ? discount : 0;
  const fixedAfter = Math.round(fixedCents * (1 - effDiscount / 100));
  const perInvoiceMonths = cycle === 'MONTHLY' || !hasStart ? 1 : cycle === 'ANNUAL' ? 12 : termMonths ?? 1;
  const unsaved = rows.filter((r) => r.changes).length;

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
      quotedRateCents: chosen.quoted ? toCents(quoted) : null,
      includedStaff: chosen.quoted && chosen.staffPerFacility !== null && staffQuote.trim() ? Number(staffQuote) : null,
      extraStaffSeats: seats,
      billingCycle: cycle,
      termMonths,
      termStart: startMonth ? `${startMonth}-01` : null,
      discountPercent: discountText === null ? null : discount,
      items: Object.fromEntries(rows.map((r) => [r.k, { on: r.on, cents: r.custom ? r.price : null }])),
      trialEndsOn: s('trialEnds'),
      graceDays: Number(s('grace') ?? 30),
      suspensionHoldUntil: s('hold'),
      preferredPayment: s('preferred') ?? 'INVOICE',
      clubUserRateCents: toCents(userRate) ?? cat.private.userCents,
      notes: s('notes'),
      facilities: d.facilities.map((x) => ({ id: x.id, tier: fac[x.id]!.tier, customCents: toCents(fac[x.id]!.custom) })),
    };
    setBusy('save');
    try {
      await papi(`/billing/accounts/${id}`, { method: 'PUT', body });
      toast(t('billing.accountSaved'), 'ok');
      await reload();
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

  const trialOn = d.state?.stage === 'trial';
  let n = 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {est ? (
        <Card>
          <CardHeader
            className="flex-wrap"
            title={t('billing.thisMonth')}
            description={t('billing.thisMonthHelp', { count: est.activeUsers })}
            action={<Button size="sm" icon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'draft'} onClick={() => void draft()}>{t('billing.draftThisMonth')}</Button>}
          />
          <CardBody className="pt-3">
            <ul className="divide-y divide-line text-small">
              {est.lines.map((l, i) => (
                <li key={`${l.description}${i}`} className="flex justify-between gap-3 py-2">
                  <span className={l.amountCents < 0 ? 'text-ok' : undefined}>
                    {l.description}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                  </span>
                  <span className={cn('tabular-nums', l.amountCents < 0 && 'text-ok')}>{cad(l.amountCents, lng)}</span>
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
        <CardBody className="pt-4">
          <form onSubmit={(e) => void save(e)} className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <Part n={++n} title={t('billing.sectorTitle')} hint={t('billing.sectorHint')}>
              <Segmented
                label={t('billing.sectorTitle')}
                value={p}
                onChange={setP}
                options={[
                  { value: 'MUNICIPAL' as const, label: t('plans.sector.MUNICIPAL') },
                  { value: 'CLUB' as const, label: t('plans.sector.CLUB') },
                ]}
              />
            </Part>

            {p === 'MUNICIPAL' ? (
              <Part n={++n} title={t('billing.chooseLevel')} hint={t('billing.chooseLevelHint')}>
                <div role="radiogroup" aria-label={t('billing.chooseLevel')} className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                  {PLAN_LEVELS.map((l) => {
                    const pl = cat.public[l];
                    const picked = lv === l;
                    return (
                      <label key={l} className={cn('relative grid cursor-pointer content-start gap-1.5 rounded-xl border p-4 text-small transition-colors', picked ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line hover:border-brand/50')}>
                        <input type="radio" name="level" value={l} checked={picked} onChange={() => setLv(l)} className="sr-only" />
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-body-strong">{t(`plans.level.${l}`)}</span>
                          {pl.quoted ? <StatusPill tone="new">{t('billing.quotedPill')}</StatusPill> : picked ? <StatusPill tone="brand">{t('billing.chosen')}</StatusPill> : null}
                        </span>
                        <span className="text-heading tabular-nums">{cents(pl.listCents, lng)}</span>
                        <span className="text-caption text-muted">{t('billing.perStandardFacility')}</span>
                        <span className="mt-1 text-caption">{pl.staffPerFacility === null ? t('plans.staffUnlimited') : t('plans.staffIncluded', { count: pl.staffPerFacility })}</span>
                        <span className="text-caption text-muted">{t('billing.optionsCount', { count: pl.items.length })}</span>
                      </label>
                    );
                  })}
                </div>
                {chosen.quoted ? (
                  <div className="grid gap-4 rounded-xl bg-surface p-4 sm:grid-cols-2">
                    <Field label={t('billing.quotedRate')} hint={t('billing.quotedRateHint', { price: cents(chosen.listCents, lng) })}>
                      {(fp) => <Input {...fp} inputMode="decimal" value={quoted} onChange={(e) => setQuoted(e.target.value)} />}
                    </Field>
                    {chosen.staffPerFacility !== null ? (
                      <Field label={t('billing.includedStaff')} hint={t('billing.includedStaffHint', { count: chosen.staffPerFacility })}>
                        {(fp) => <Input {...fp} inputMode="numeric" placeholder={String(allowance ?? '')} value={staffQuote} onChange={(e) => setStaffQuote(e.target.value)} />}
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </Part>
            ) : (
              <Part n={++n} title={t('billing.privateCoreTitle')} hint={t('plans.privateCore', { price: cents(cat.private.coreCents, lng), count: cat.private.includedUsers, each: money(cat.private.userCents) })}>
                <div className="w-48">
                  <Field label={t('billing.clubRate')}>{(fp) => <Input {...fp} inputMode="decimal" value={userRate} onChange={(e) => setUserRate(e.target.value)} />}</Field>
                </div>
              </Part>
            )}

            {p === 'MUNICIPAL' ? (
              <Part n={++n} title={t('billing.facilitySizes')} hint={t('billing.facilitySizesHint')}>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {d.facilities.map((x, i) => (
                    <li key={x.id} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_14rem_9rem_7rem]">
                      <p className="flex items-center gap-2 text-small font-semibold"><Building2 className="h-4 w-4 text-muted" aria-hidden="true" />{x.name}</p>
                      <Select aria-label={t('billing.size')} value={fac[x.id]!.tier ?? ''} onChange={(e) => setFac((m) => ({ ...m, [x.id]: { ...m[x.id]!, tier: e.target.value ? Number(e.target.value) : null } }))}>
                        <option value="">{t('billing.notBilled')}</option>
                        {[1, 2, 3].map((s) => <option key={s} value={s}>{t(`plans.size.${s}`)} · {cat.sizePercent[s]}%</option>)}
                      </Select>
                      <Input aria-label={t('billing.contractRate')} placeholder={t('billing.contractRateShort')} inputMode="decimal" value={fac[x.id]!.custom} onChange={(e) => setFac((m) => ({ ...m, [x.id]: { ...m[x.id]!, custom: e.target.value } }))} />
                      <p className="text-right text-small font-semibold tabular-nums">{facLines[i] ? money(facLines[i]!) : '—'}</p>
                    </li>
                  ))}
                </ul>
              </Part>
            ) : null}

            <Part
              n={++n}
              title={t('billing.optionsTitle')}
              hint={trialOn ? t('billing.modulesTrial') : p === 'CLUB' ? t('billing.optionsHintPrivate') : t('billing.optionsHintPublic')}
              aside={optionsCents ? <span className={cn('rounded-full px-3 py-1 text-small font-semibold tabular-nums', optionsCents < 0 ? 'bg-ok-bg text-ok' : 'bg-brand/10 text-brand-text')}>{optionsCents > 0 ? '+' : '−'}{money(Math.abs(optionsCents))} {t('billing.perMonthShort')}</span> : null}
            >
              <div className="grid gap-4">
                {GROUPS.map((g) => {
                  const list = rows.filter((r) => cat.items[r.k].group === g);
                  return (
                    <div key={g} className="overflow-hidden rounded-xl border border-line">
                      <p className="bg-surface px-4 py-2 text-caption font-semibold uppercase tracking-wide text-muted">{t(`plans.group.${g}`)}</p>
                      <ul className="divide-y divide-line">
                        {list.map((r) => (
                          <li key={r.k} className={cn('grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_8.5rem_7rem]', !r.on && 'bg-page/40')}>
                            <Switch on={r.on} onChange={() => setOn(r.k, !r.on)} label={t(`plans.item.${r.k}`)} />
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-small">
                                <span className={cn('font-semibold', !r.on && 'text-muted')}>{t(`plans.item.${r.k}`)}</span>
                                {r.standard ? <StatusPill tone="neutral">{t('billing.inPlan')}</StatusPill> : null}
                                {r.changes ? <StatusPill tone="warn">{r.on ? t('billing.willTurnOn') : t('billing.willTurnOff')}</StatusPill> : null}
                              </p>
                              <p className="text-caption text-muted">{t(`plans.itemIncludes.${r.k}`)}</p>
                            </div>
                            <div className="col-start-2 flex items-center justify-between gap-3 sm:contents">
                            <div className="flex w-36 items-center gap-1 sm:w-auto">
                              <span className="text-small text-muted">$</span>
                              <Input
                                aria-label={t('billing.itemPrice', { name: t(`plans.item.${r.k}`) })}
                                inputMode="decimal"
                                className="h-9 text-right tabular-nums"
                                value={choice[r.k]?.price ?? toDollars(stdPrice(r.k))}
                                onChange={(e) => setPrice(r.k, e.target.value)}
                              />
                              {r.custom ? (
                                <button type="button" onClick={() => setPrice(r.k, undefined)} className="rounded-md p-1 text-muted hover:text-ink" title={t('billing.standardPrice', { price: money(stdPrice(r.k)) })} aria-label={t('billing.standardPrice', { price: money(stdPrice(r.k)) })}>
                                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                            <p className={cn('text-right text-small font-semibold tabular-nums', p === 'CLUB' ? (r.on ? '' : 'text-muted') : r.effect > 0 ? 'text-brand-text' : r.effect < 0 ? 'text-ok' : 'text-muted')}>
                              {p === 'CLUB' ? (r.on ? `+${money(r.price)}` : '—') : r.effect > 0 ? `+${money(r.effect)}` : r.effect < 0 ? `−${money(-r.effect)}` : r.on ? t('billing.included') : '—'}
                            </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <p className="text-caption text-muted">{t('billing.addOnsLock')}</p>
            </Part>

            {p === 'CLUB' || chosen.staffPerFacility !== null ? (
              <Part n={++n} title={t('billing.staffTitle')} hint={t('billing.seatsHint', { price: money(perPerson) })}>
                {est ? <StaffMeter staff={est.staff} lng={lng} /> : null}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-48">
                    <Field label={t('billing.seats')}>{(fp) => <Input {...fp} type="number" min={0} step={5} inputMode="numeric" value={seatsText} onChange={(e) => setSeatsText(e.target.value)} />}</Field>
                  </div>
                  <div className="flex gap-2 pb-0.5">
                    {[10, 25, 50].map((k) => (
                      <Button key={k} type="button" size="sm" variant="secondary" icon={<Users className="h-4 w-4" aria-hidden="true" />} onClick={() => setSeatsText(String(seats + k))}>+{k}</Button>
                    ))}
                  </div>
                </div>
              </Part>
            ) : null}

            <Part n={++n} title={t('billing.termsTitle')} hint={t('billing.termsHint')}>
              <Segmented<Cycle>
                label={t('billing.cycle')}
                value={cycle}
                onChange={setCycle}
                options={(['MONTHLY', 'ANNUAL', 'TERM'] as const).map((c) => ({ value: c, label: t(`billing.cycles.${c}`) }))}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('billing.term')} hint={cycle === 'TERM' ? t('billing.termRequired') : t('billing.termHint')}>
                  {(fp) => (
                    <Select {...fp} value={TERM_CHOICES.includes(Number(termText)) || !termText ? termText : 'custom'} onChange={(e) => setTermText(e.target.value === 'custom' ? '18' : e.target.value)}>
                      <option value="">{t('billing.monthToMonth')}</option>
                      {TERM_CHOICES.map((m) => <option key={m} value={String(m)}>{t('billing.years', { count: m / 12 })}</option>)}
                      <option value="custom">{t('billing.customTerm')}</option>
                    </Select>
                  )}
                </Field>
                {termText && !TERM_CHOICES.includes(Number(termText)) ? (
                  <Field label={t('billing.termMonths')}>{(fp) => <Input {...fp} type="number" min={1} max={120} inputMode="numeric" value={termText} onChange={(e) => setTermText(e.target.value)} />}</Field>
                ) : null}
                <Field label={t('billing.termStart')} hint={t('billing.termStartHint')}>{(fp) => <Input {...fp} type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />}</Field>
                <Field label={t('billing.discount')} hint={t('billing.discountHint', { percent: stdDiscount })}>
                  {(fp) => (
                    <div className="flex items-center gap-2">
                      <Input {...fp} inputMode="decimal" value={discountText ?? String(stdDiscount)} onChange={(e) => setDiscountText(e.target.value)} />
                      <span className="text-small text-muted">%</span>
                      {discountText !== null ? (
                        <button type="button" onClick={() => setDiscountText(null)} className="rounded-md p-1 text-muted hover:text-ink" aria-label={t('billing.standardDiscount', { percent: stdDiscount })} title={t('billing.standardDiscount', { percent: stdDiscount })}>
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  )}
                </Field>
              </div>
              {!hasStart && cycle !== 'MONTHLY' ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{t('billing.needStart')}</p> : null}
              <dl className="grid gap-3 rounded-xl bg-surface p-4 sm:grid-cols-4">
                {[
                  { k: t('billing.perInvoice', { count: perInvoiceMonths }), v: money(fixedAfter * perInvoiceMonths) },
                  { k: t('billing.monthlyEquivalent'), v: money(fixedAfter) },
                  { k: t('billing.perYear'), v: money(fixedAfter * 12) },
                  { k: t('billing.contractTotal'), v: termMonths ? money(fixedAfter * termMonths) : t('billing.noTerm') },
                ].map((x) => (
                  <div key={x.k}>
                    <dt className="text-caption text-muted">{x.k}</dt>
                    <dd className="text-body-strong tabular-nums">{x.v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-caption text-muted">{t('billing.termsFoot')}</p>
              {/* The plain-language terms the organization sees beside its pay and debit buttons, live as FH edits them. */}
              <div className="grid gap-1">
                <p className="text-caption text-muted">{t('renewal.consoleHelp')}</p>
                <RenewalTerms
                  title={t('renewal.consoleTitle')}
                  term={{
                    cycle,
                    termMonths: hasStart ? termMonths : null,
                    termEnd: hasStart && termMonths ? (() => { const [y, m] = startMonth.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, m - 1 + termMonths, 1) - 86_400_000).toISOString().slice(0, 10); })() : null,
                    discountPercent: effDiscount,
                    monthlyFixedCents: fixedCents,
                    monthlyFixedAfterDiscountCents: fixedAfter,
                    perInvoiceFixedCents: fixedAfter * perInvoiceMonths,
                    perInvoiceMonths,
                  }}
                />
              </div>
            </Part>

            <Part n={++n} title={t('billing.accessTitle')}>
            <div className="grid gap-3">
              {d.state ? (
                <p className="text-small">
                  <StatusPill tone={({ unbilled: 'neutral', trial: 'brand', ok: 'ok', overdue: 'warn', suspended: 'danger' } as const)[d.state.stage]}>{t(`billing.stage.${d.state.stage}`)}</StatusPill>
                  {d.state.suspendsOn ? <span className="ml-2 text-muted">{t(d.state.stage === 'suspended' ? 'billing.suspendedSince' : 'billing.suspendsOn', { date: d.state.suspendsOn })}</span> : null}
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
            </div>
            </Part>

            <Part n={++n} title={t('billing.billToTitle')}>
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
                    <Select {...fp} name="province" defaultValue={a?.province ?? d.facilities[0]?.province ?? 'BC'}>
                      {PROVINCES.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('billing.postal')}>{(fp) => <Input {...fp} name="postal" defaultValue={a?.postalCode ?? ''} autoComplete="postal-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={7} />}</Field>
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
            </Part>

            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-5 -mb-5 flex md:bottom-0 flex-wrap items-center justify-between gap-3 rounded-b-xl2 border-t border-line bg-panel/95 px-5 py-3 backdrop-blur">
              <div className="text-small">
                <span className="text-muted">{t('billing.liveEstimate')}</span>{' '}
                <span className="text-body-strong tabular-nums">{money(fixedAfter + overageCents)}</span>
                {effDiscount ? <span className="ml-1 text-caption text-muted">({t('billing.afterDiscount', { percent: effDiscount })})</span> : null}
                {unsaved ? <span className="ml-2 text-caption text-warn">{t('billing.unsaved', { count: unsaved })}</span> : null}
              </div>
              <Button type="submit" loading={busy === 'save'}>{t('billing.saveAndApply')}</Button>
            </div>
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
        <div className={`fh-bar h-full ${staff.over ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
      {staff.over ? <p className="text-small text-warn">{t('billing.staffOver', { count: staff.over, amount: cents(staff.over * staff.rateCents, lng, false) })}</p> : null}
    </div>
  );
}
