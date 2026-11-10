'use client';

import { BadgeCheck, ChevronLeft, CreditCard, Plus, Search, ShieldAlert, Ticket, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, api } from '@/lib/api';
import { type Fee, type LessonSet, PAYMENT_METHODS, ageLabel, ageRange, hhmm, money } from '@/lib/programs';
import { useAction, useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/Toast';

interface Member { id: string; role: 'GUARDIAN' | 'CHILD' | 'ADULT'; firstName: string; lastName: string; dateOfBirth: string | null; ageMonths: number | null; email: string | null; phone: string | null; safetyNote: string | null }
interface Family {
  id: string; name: string; address: string | null; emergencyName: string | null; emergencyPhone: string | null; memberUntil: string | null;
  members: Member[];
  enrollments: Array<{ id: string; memberId: string | null; swimmerName: string; status: 'ENROLLED' | 'WAITLISTED' | 'CANCELLED'; priceCents: number | null; set: { name: string; startsOn: string; endsOn: string; daysOfWeek: number[]; startMinute: number } }>;
  sales: Array<{ id: string; description: string; priceCents: number; validFrom: string | null; validTo: string | null; paymentMethod: string; refundedAt: string | null; createdAt: string; feeId: string | null }>;
}
interface Offering { id: string; name: string; kind: string; registrationOpen: boolean; registrationOpensAt: string | null; sets: LessonSet[] }

/** Member services: families on file, registrations, memberships and drop-ins. */
export default function MembersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Members />
    </Suspense>
  );
}

function Members() {
  const id = useSearchParams().get('id');
  return id ? <FamilyView id={id} /> : <FamilySearch />;
}

function FamilySearch() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const list = useQuery<Array<{ id: string; name: string; members: Array<{ id: string; role: string; name: string; ageMonths: number | null; phone: string | null }> }>>(`/api/households?q=${encodeURIComponent(q)}`);
  const fees = useQuery<Fee[]>('/api/fees');
  const summary = useQuery<{ count: number; totalCents: number; byMethod: Record<string, number> }>('/api/sales/summary');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [rows, setRows] = useState<Array<{ role: Member['role'] }>>([{ role: 'GUARDIAN' }, { role: 'CHILD' }]);
  const [dropIn, setDropIn] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const members = rows.map((r, i) => ({ role: r.role, firstName: s(`first${i}`), lastName: s(`last${i}`) ?? s('name'), dateOfBirth: s(`dob${i}`), phone: s(`phone${i}`), email: s(`email${i}`), safetyNote: s(`note${i}`) })).filter((m) => m.firstName);
    const r = await run('family', () => api<{ id: string }>('/api/households', { method: 'POST', body: { name: s('name'), address: s('address'), emergencyName: s('emName'), emergencyPhone: s('emPhone'), members } }), t('members.familyAdded'));
    if (r) window.location.assign(`/members?id=${r.id}`);
  }
  async function sellDropIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if ((await run('drop', () => api('/api/sales', { method: 'POST', body: { feeId: String(f.get('fee')), paymentMethod: String(f.get('pay')) } }), t('members.sold'))) !== undefined) {
      setDropIn(false);
      await summary.reload();
    }
  }
  const quick = (fees.data ?? []).filter((x) => x.active && (x.kind === 'DROP_IN' || x.kind === 'PASS'));
  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('members.title')}
        description={t('members.description')}
        actions={
          <>
            <Button variant="secondary" icon={<Ticket className="h-4 w-4" aria-hidden="true" />} disabled={!quick.length} onClick={() => setDropIn(true)}>{t('members.dropIn')}</Button>
            <Button icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('members.newFamily')}</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardBody className="grid gap-4">
            <Field label={t('members.search')}>{(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('members.searchPlaceholder')} />}</Field>
            {!list.data ? <Skeleton className="h-32" /> : !list.data.length ? (
              <EmptyState icon={Search} title={q ? t('members.noMatch') : t('members.noFamilies')}>{t('members.noFamiliesHelp')}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {list.data.map((h) => (
                  <li key={h.id}>
                    <Link href={`/members?id=${h.id}`} className="block rounded-lg py-3 hover:bg-surface/60">
                      <span className="font-semibold">{h.name}</span>
                      <span className="block text-caption text-muted">{h.members.map((m) => `${m.name}${m.ageMonths !== null && m.role === 'CHILD' ? ` (${ageLabel(m.ageMonths, t)})` : ''}`).join(' · ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('members.today')} />
          <CardBody className="grid gap-1 pt-2 text-small">
            {!summary.data ? <Skeleton className="h-16" /> : (
              <>
                <p className="text-title tabular-nums">{money(summary.data.totalCents, i18n.language)}</p>
                <p className="text-caption text-muted">{t('members.salesCount', { count: summary.data.count })}</p>
                {Object.entries(summary.data.byMethod).map(([m, c]) => <p key={m} className="flex justify-between"><span>{t(`members.pay.${m}`)}</span><span className="tabular-nums">{money(c, i18n.language)}</span></p>)}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <OnlineSignups />

      <Dialog open={adding} onClose={() => setAdding(false)} title={t('members.newFamily')} description={t('members.newFamilyHelp')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void create(e)}>
          <Field label={t('members.familyName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} />}</Field>
          <Field label={t('members.address')} hint={t('common.optional')}>{(p) => <Input {...p} name="address" maxLength={200} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('members.emergencyName')}>{(p) => <Input {...p} name="emName" maxLength={80} />}</Field>
            <Field label={t('members.emergencyPhone')}>{(p) => <Input {...p} name="emPhone" type="tel" maxLength={30} />}</Field>
          </div>
          {rows.map((r, i) => (
            <fieldset key={i} className="grid gap-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-small font-semibold">{t(`members.role.${r.role}`)}</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('members.first')}>{(p) => <Input {...p} name={`first${i}`} maxLength={60} required={i === 0} />}</Field>
                <Field label={t('members.last')} hint={t('members.lastHint')}>{(p) => <Input {...p} name={`last${i}`} maxLength={60} />}</Field>
                {r.role === 'CHILD' ? (
                  <>
                    <Field label={t('members.dob')}>{(p) => <Input {...p} name={`dob${i}`} type="date" required />}</Field>
                    <Field label={t('members.safetyNote')} hint={t('members.safetyHint')}>{(p) => <Input {...p} name={`note${i}`} maxLength={200} />}</Field>
                  </>
                ) : (
                  <>
                    <Field label={t('members.phone')}>{(p) => <Input {...p} name={`phone${i}`} type="tel" maxLength={30} />}</Field>
                    <Field label={t('members.email')}>{(p) => <Input {...p} name={`email${i}`} type="email" maxLength={160} />}</Field>
                  </>
                )}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRows((x) => [...x, { role: 'CHILD' }])}>{t('members.addChild')}</Button>
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRows((x) => [...x, { role: 'GUARDIAN' }])}>{t('members.addGuardian')}</Button>
          </div>
          <Button type="submit" loading={busy === 'family'} className="justify-self-start">{t('members.saveFamily')}</Button>
        </form>
      </Dialog>

      <Dialog open={dropIn} onClose={() => setDropIn(false)} title={t('members.dropIn')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void sellDropIn(e)}>
          <Field label={t('members.what')}>{(p) => <Select {...p} name="fee">{quick.map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.priceCents, i18n.language)}</option>)}</Select>}</Field>
          <Field label={t('members.payment')}>{(p) => <Select {...p} name="pay">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`members.pay.${m}`)}</option>)}</Select>}</Field>
          <Button type="submit" loading={busy === 'drop'} icon={<CreditCard className="h-4 w-4" aria-hidden="true" />} className="justify-self-start">{t('members.charge')}</Button>
        </form>
      </Dialog>
    </div>
  );
}

/** Families who signed up on the public page: take payment for confirmed spots. */
function OnlineSignups() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Array<{ id: string; reference: string; swimmerName: string; householdId: string; status: string; priceCents: number | null; set: string; createdAt: string; paid: boolean }>>('/api/online-registrations');
  const { run, busy } = useAction();
  const [pay, setPay] = useState<string>('DEBIT');
  const due = (q.data ?? []).filter((r) => !r.paid && r.status === 'ENROLLED');
  if (!q.data || !q.data.length) return null;
  return (
    <Card>
      <CardHeader title={t('members.online', { count: due.length })} description={t('members.onlineHelp')} action={<div className="w-40"><Select aria-label={t('members.payment')} value={pay} onChange={(e) => setPay(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`members.pay.${m}`)}</option>)}</Select></div>} />
      <CardBody className="pt-2">
        {!due.length ? <p className="text-small text-muted">{t('members.onlineNone')}</p> : (
          <ul className="divide-y divide-line text-small">
            {due.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/members?id=${r.householdId}`} className="min-w-0 hover:underline"><span className="font-semibold">{r.swimmerName}</span><span className="block text-caption text-muted">{r.set} · {r.reference} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(r.createdAt))}</span></Link>
                <Button size="sm" loading={busy === r.id} icon={<CreditCard className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(r.id, () => api(`/api/online-registrations/${r.id}/pay`, { method: 'POST', body: { paymentMethod: pay } }), t('members.sold')).then(() => q.reload())}>{t('members.takePayment', { price: money(r.priceCents, i18n.language) })}</Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function FamilyView({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const fam = useQuery<Family>(`/api/households/${id}`);
  const fees = useQuery<Fee[]>('/api/fees');
  const { run, busy } = useAction();
  const [registering, setRegistering] = useState<Member | null>(null);
  const offers = useQuery<Offering[]>(registering ? `/api/offerings?memberId=${registering.id}` : null);
  const [selling, setSelling] = useState(false);
  const [override, setOverride] = useState<{ set: LessonSet; pay: string } | null>(null);
  const [pay, setPay] = useState<string>('DEBIT');
  const date = (d: string | null) => (d ? new Intl.DateTimeFormat(lng, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) : '—');
  const dow = (d: number) => new Intl.DateTimeFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));

  async function register(set: LessonSet, ageOverride?: string) {
    try {
      const r = await api<{ status: string; priceCents: number }>('/api/registrations', { method: 'POST', body: { setId: set.id, memberId: registering!.id, paymentMethod: pay, ...(ageOverride ? { ageOverride } : {}) } });
      toast(r.status === 'WAITLISTED' ? t('members.waitlisted') : t('members.registered', { price: money(r.priceCents, lng) }), 'ok');
      setRegistering(null);
      setOverride(null);
      await fam.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AGE_OUTSIDE_LEVEL') setOverride({ set, pay });
      else toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    }
  }
  async function sell(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { feeId: String(f.get('fee')), householdId: id, memberId: String(f.get('member') || '') || null, startsOn: String(f.get('starts') || '') || undefined, paymentMethod: String(f.get('pay')) };
    if ((await run('sell', () => api('/api/sales', { method: 'POST', body }), t('members.sold'))) !== undefined) {
      setSelling(false);
      await fam.reload();
    }
  }

  if (!fam.data) return <Skeleton className="h-96" />;
  const h = fam.data;
  const guardians = h.members.filter((m) => m.role !== 'CHILD');
  return (
    <div className="grid gap-6">
      <Link href="/members" className="inline-flex items-center gap-1 text-small font-semibold text-brand-text hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('members.title')}</Link>
      <PageHeader
        title={h.name}
        description={h.emergencyName ? t('members.emergency', { name: h.emergencyName, phone: h.emergencyPhone ?? '' }) : undefined}
        actions={
          <>
            {h.memberUntil ? <StatusPill tone="ok" icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}>{t('members.memberUntil', { date: date(h.memberUntil) })}</StatusPill> : <StatusPill tone="neutral">{t('members.notMember')}</StatusPill>}
            <Button variant="secondary" icon={<CreditCard className="h-4 w-4" aria-hidden="true" />} onClick={() => setSelling(true)}>{t('members.sell')}</Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {h.members.map((m) => (
          <Card key={m.id}>
            <CardBody className="grid gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{m.firstName} {m.lastName}</p>
                  <p className="text-caption text-muted">{t(`members.role.${m.role}`)}{m.ageMonths !== null ? ` · ${ageLabel(m.ageMonths, t)}` : ''}{m.phone ? ` · ${m.phone}` : ''}</p>
                </div>
                {m.role !== 'GUARDIAN' || m.ageMonths !== null ? <Button size="sm" onClick={() => setRegistering(m)}>{t('members.register')}</Button> : null}
              </div>
              {m.safetyNote ? <p className="flex items-center gap-1.5 rounded-lg bg-warn-bg px-2 py-1 text-caption text-warn"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />{m.safetyNote}</p> : null}
              {h.enrollments.filter((e) => e.memberId === m.id && e.status !== 'CANCELLED').map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-2 py-1.5 text-caption">
                  <span><span className="font-semibold">{e.set.name}</span> · {e.set.daysOfWeek.map(dow).join(' ')} {hhmm(e.set.startMinute)} · {date(e.set.startsOn)}</span>
                  <span className="flex items-center gap-2">
                    {e.status === 'WAITLISTED' ? <StatusPill tone="warn">{t('programs.waitlisted')}</StatusPill> : null}
                    <button type="button" className="font-semibold text-danger hover:underline" onClick={() => void run(`c${e.id}`, () => api<{ promoted: { swimmerName: string } | null }>(`/api/registrations/${e.id}/cancel`, { method: 'POST', body: { refund: true } }), t('members.cancelled')).then(async (r) => { if (r?.promoted) toast(t('members.promoted', { name: r.promoted.swimmerName }), 'ok'); await fam.reload(); })}>{t('members.cancel')}</button>
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title={t('members.history')} />
        <CardBody className="pt-1">
          {!h.sales.length ? <p className="text-small text-muted">{t('members.noSales')}</p> : (
            <ul className="divide-y divide-line text-small">
              {h.sales.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className={s.refundedAt ? 'line-through' : 'font-semibold'}>{s.description.replace(/^[A-Z]: /, '')}</span><span className="block text-caption text-muted">{date(s.createdAt.slice(0, 10))} · {t(`members.pay.${s.paymentMethod}`)}{s.validTo && s.validTo !== s.validFrom ? ` · ${t('members.valid', { from: date(s.validFrom), to: date(s.validTo) })}` : ''}</span></span>
                  <span className="flex items-center gap-3"><span className="tabular-nums">{money(s.priceCents, lng)}</span>{s.refundedAt ? <StatusPill tone="neutral">{t('members.refunded')}</StatusPill> : <button type="button" className="text-caption font-semibold text-muted hover:underline" onClick={() => void run(`r${s.id}`, () => api(`/api/sales/${s.id}/refund`, { method: 'POST' }), t('members.refundDone')).then(() => fam.reload())}>{t('members.refund')}</button>}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Dialog open={!!registering} onClose={() => { setRegistering(null); setOverride(null); }} title={t('members.registerTitle', { name: registering?.firstName ?? '' })} description={registering?.ageMonths != null ? t('members.registerHelp', { age: ageLabel(registering.ageMonths, t) }) : undefined} closeLabel={t('common.close')}>
        <div className="grid gap-4">
          <Field label={t('members.payment')}>{(p) => <Select {...p} value={pay} onChange={(e) => setPay(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`members.pay.${m}`)}</option>)}</Select>}</Field>
          {override ? (
            <form className="grid gap-3 rounded-xl bg-warn-bg p-4" onSubmit={(e) => { e.preventDefault(); void register(override.set, String(new FormData(e.currentTarget).get('why'))); }}>
              <p className="text-small font-semibold text-warn">{t('members.ageOutside', { range: ageRange(override.set.minAgeMonths, override.set.maxAgeMonths, t) })}</p>
              <Field label={t('members.overrideWhy')}>{(p) => <Input {...p} name="why" required minLength={3} maxLength={200} />}</Field>
              <Button type="submit" size="sm" className="justify-self-start">{t('members.registerAnyway')}</Button>
            </form>
          ) : null}
          {!offers.data ? <Skeleton className="h-32" /> : !offers.data.length ? <p className="text-small text-muted">{t('members.nothingOpen')}</p> : offers.data.map((c) => (
            <div key={c.id} className="grid gap-2">
              <p className="text-small font-semibold">{c.name}{!c.registrationOpen ? <span className="ml-2 text-caption text-warn">{t('members.notOpenYet')}</span> : null}</p>
              {[...c.sets].sort((a, b) => Number(b.ageFits) - Number(a.ageFits)).map((s) => (
                <button key={s.id} type="button" disabled={!c.registrationOpen} onClick={() => void register(s)} className={`grid gap-0.5 rounded-xl border p-3 text-left text-small transition-colors disabled:opacity-50 ${s.ageFits ? 'border-brand/50 hover:bg-brand/5' : 'border-line opacity-70 hover:bg-surface'}`}>
                  <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{s.name}</span><span className="tabular-nums">{money(h.memberUntil && s.memberPriceCents != null ? s.memberPriceCents : s.priceCents, lng)}</span></span>
                  <span className="text-caption text-muted">{s.daysOfWeek.map(dow).join(' ')} {hhmm(s.startMinute)}–{hhmm(s.endMinute)} · {date(s.startsOn)} – {date(s.endsOn)} · {s.facility} · {ageRange(s.minAgeMonths, s.maxAgeMonths, t)}</span>
                  <span className="text-caption">{s.ageFits === false ? <span className="text-warn">{t('members.ageNoFit')}</span> : null} {s.spotsLeft ? t('members.spots', { count: s.spotsLeft }) : <span className="text-warn">{t('members.fullWaitlist')}</span>}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Dialog>

      <Dialog open={selling} onClose={() => setSelling(false)} title={t('members.sell')} description={t('members.sellHelp')} closeLabel={t('common.cancel')}>
        {!fees.data ? <Skeleton className="h-24" /> : !fees.data.filter((x) => x.active).length ? <p className="text-small text-muted">{t('members.noPrices')}</p> : (
          <form className="grid gap-4" onSubmit={(e) => void sell(e)}>
            <Field label={t('members.what')}>{(p) => <Select {...p} name="fee">{(['MEMBERSHIP', 'PASS', 'DROP_IN', 'PROGRAM'] as const).map((k) => <optgroup key={k} label={t(`fees.kind.${k}`)}>{fees.data!.filter((x) => x.kind === k && x.active).map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.priceCents, lng)}</option>)}</optgroup>)}</Select>}</Field>
            <Field label={t('members.forWhom')} hint={t('common.optional')}>{(p) => <Select {...p} name="member" defaultValue=""><option value="">{t('members.wholeFamily')}</option>{h.members.map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}</Select>}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('members.starts')}>{(p) => <Input {...p} name="starts" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
              <Field label={t('members.payment')}>{(p) => <Select {...p} name="pay">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`members.pay.${m}`)}</option>)}</Select>}</Field>
            </div>
            <Button type="submit" loading={busy === 'sell'} icon={<CreditCard className="h-4 w-4" aria-hidden="true" />} className="justify-self-start">{t('members.charge')}</Button>
          </form>
        )}
      </Dialog>
      {guardians.length === 0 ? <p className="text-caption text-warn"><Users className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t('members.noGuardian')}</p> : null}
    </div>
  );
}
