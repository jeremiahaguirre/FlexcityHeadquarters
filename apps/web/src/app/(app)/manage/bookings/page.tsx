'use client';

import { Check, Copy, Globe, Plus, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { hhmm, money, toMinutes } from '@/lib/programs';
import { useAction, useQuery } from '@/lib/useQuery';

interface Settings { enabled: boolean; terms: string; termsFr: string; payment: string; paymentFr: string; privacyContact: string }
interface Service { id: string; facilityId: string; name: string; nameFr: string | null; description: string | null; durationMinutes: number; priceCents: number; capacity: number; maxPartySize: number | null; daysOfWeek: number[]; openMinute: number; closeMinute: number; leadDays: number; active: boolean }
interface Booking { id: string; service: string; startsAt: string; endsAt: string; partySize: number | null; name: string; email: string; phone: string; organization: string | null; notes: string | null; status: 'REQUESTED' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED'; reference: string }
const TONE: Record<Booking['status'], Tone> = { REQUESTED: 'new', CONFIRMED: 'ok', DECLINED: 'neutral', CANCELLED: 'neutral' };

/** The public sign-up page's settings, what the public can book, and booking requests. */
export default function BookingsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const settings = useQuery<Settings>('/api/signup/settings');
  const services = useQuery<Service[]>('/api/bookable-services');
  const bookings = useQuery<Booking[]>('/api/bookings');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(`${window.location.origin}/signup`), []);
  const dow = (d: number) => new Intl.DateTimeFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
  const when = (iso: string) => new Intl.DateTimeFormat(lng, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = { enabled: f.get('enabled') === 'on', terms: s('terms'), termsFr: s('termsFr'), payment: s('payment'), paymentFr: s('paymentFr'), privacyContact: s('privacy') };
    if ((await run('settings', () => api('/api/signup/settings', { method: 'PUT', body }), t('bookingsPage.saved'))) !== undefined) await settings.reload();
  }
  async function addService(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = { facilityId: s('facility'), name: s('name'), nameFr: s('nameFr') || null, description: s('description') || null, durationMinutes: Number(s('duration')), priceCents: Math.round(Number(s('price').replace(',', '.')) * 100), capacity: Number(s('capacity') || 1), maxPartySize: s('party') ? Number(s('party')) : null, daysOfWeek: days, openMinute: toMinutes(s('open')), closeMinute: toMinutes(s('close')), leadDays: Number(s('lead') || 2) };
    if ((await run('service', () => api('/api/bookable-services', { method: 'POST', body }), t('bookingsPage.serviceAdded'))) !== undefined) {
      setAdding(false);
      await services.reload();
    }
  }
  const decide = (b: Booking, decision: 'CONFIRMED' | 'DECLINED') => void run(`${b.id}${decision}`, () => api(`/api/bookings/${b.id}/decide`, { method: 'POST', body: { decision } }), t(decision === 'CONFIRMED' ? 'bookingsPage.confirmed' : 'bookingsPage.declined')).then(() => bookings.reload());

  return (
    <div className="grid gap-6">
      <PageHeader title={t('bookingsPage.title')} description={t('bookingsPage.description')} />
      <Card>
        <CardHeader title={t('bookingsPage.requests')} />
        <CardBody className="pt-2">
          {!bookings.data ? <Skeleton className="h-24" /> : !bookings.data.length ? <p className="text-small text-muted">{t('bookingsPage.noRequests')}</p> : (
            <ul className="divide-y divide-line text-small">
              {bookings.data.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{b.service} · {when(b.startsAt)} <StatusPill tone={TONE[b.status]} className="ml-1">{t(`bookingsPage.status.${b.status}`)}</StatusPill></p>
                    <p className="text-caption text-muted">{b.name}{b.organization ? ` (${b.organization})` : ''} · {b.phone} · {b.email}{b.partySize ? ` · ${t('bookingsPage.people', { count: b.partySize })}` : ''} · {b.reference}</p>
                    {b.notes ? <p className="text-caption">“{b.notes}”</p> : null}
                  </div>
                  {b.status === 'REQUESTED' ? (
                    <div className="flex gap-2">
                      <Button size="sm" loading={busy === `${b.id}CONFIRMED`} icon={<Check className="h-4 w-4" aria-hidden="true" />} onClick={() => decide(b, 'CONFIRMED')}>{t('bookingsPage.confirm')}</Button>
                      <Button size="sm" variant="secondary" loading={busy === `${b.id}DECLINED`} icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => decide(b, 'DECLINED')}>{t('bookingsPage.decline')}</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('bookingsPage.services')} description={t('bookingsPage.servicesHelp')} action={<Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('bookingsPage.addService')}</Button>} />
        <CardBody className="pt-2">
          {!services.data ? <Skeleton className="h-24" /> : !services.data.length ? <EmptyState icon={Globe} title={t('bookingsPage.noServices')}>{t('bookingsPage.noServicesHelp')}</EmptyState> : (
            <ul className="divide-y divide-line text-small">
              {services.data.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><span className="font-semibold">{v.name}</span><span className="block text-caption text-muted">{facilities.data?.find((f) => f.id === v.facilityId)?.name} · {v.daysOfWeek.map(dow).join(' ')} {hhmm(v.openMinute)}–{hhmm(v.closeMinute)} · {t('signup.duration', { count: v.durationMinutes })} · {t('bookingsPage.atOnce', { count: v.capacity })}</span></span>
                  <span className="tabular-nums">{money(v.priceCents, lng)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('bookingsPage.portal')} description={t('bookingsPage.portalHelp')} />
        <CardBody className="grid gap-4 pt-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-small">
            <Globe className="h-4 w-4 text-brand-text" aria-hidden="true" />
            <span className="min-w-0 break-all font-semibold">{url}</span>
            <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => void navigator.clipboard.writeText(url).then(() => toast(t('bookingsPage.copied'), 'ok'), () => undefined)}>{t('bookingsPage.copy')}</Button>
          </div>
          {!settings.data ? <Skeleton className="h-40" /> : (
            <form key={String(settings.data.enabled)} className="grid gap-4" onSubmit={(e) => void saveSettings(e)}>
              <label className="flex items-start gap-3 text-small"><input type="checkbox" name="enabled" defaultChecked={settings.data.enabled} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span><span className="font-semibold">{t('bookingsPage.open')}</span><span className="block text-caption text-muted">{t('bookingsPage.openHelp')}</span></span></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('bookingsPage.terms')} hint={t('bookingsPage.termsHint')}>{(p) => <Textarea {...p} name="terms" rows={6} maxLength={5000} defaultValue={settings.data!.terms} />}</Field>
                <Field label={t('bookingsPage.termsFr')} hint={t('common.optional')}>{(p) => <Textarea {...p} name="termsFr" rows={6} maxLength={5000} defaultValue={settings.data!.termsFr} />}</Field>
                <Field label={t('bookingsPage.payment')} hint={t('bookingsPage.paymentHint')}>{(p) => <Textarea {...p} name="payment" rows={3} maxLength={1000} defaultValue={settings.data!.payment} />}</Field>
                <Field label={t('bookingsPage.paymentFr')} hint={t('common.optional')}>{(p) => <Textarea {...p} name="paymentFr" rows={3} maxLength={1000} defaultValue={settings.data!.paymentFr} />}</Field>
              </div>
              <Field label={t('bookingsPage.privacy')} hint={t('bookingsPage.privacyHint')}>{(p) => <Input {...p} name="privacy" maxLength={300} defaultValue={settings.data!.privacyContact} />}</Field>
              <Button type="submit" loading={busy === 'settings'} className="justify-self-start">{t('common.save')}</Button>
            </form>
          )}
        </CardBody>
      </Card>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('bookingsPage.addService')} description={t('bookingsPage.addServiceHelp')} closeLabel={t('common.cancel')}>
        {!facilities.data ? <Skeleton className="h-32" /> : (
          <form className="grid gap-4" onSubmit={(e) => void addService(e)}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('bookingsPage.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} placeholder={t('bookingsPage.namePlaceholder')} />}</Field>
              <Field label={t('bookingsPage.nameFr')} hint={t('common.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={80} />}</Field>
            </div>
            <Field label={t('bookingsPage.descriptionLabel')} hint={t('common.optional')}>{(p) => <Textarea {...p} name="description" maxLength={1000} rows={2} />}</Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label={t('programs.facility')}>{(p) => <Select {...p} name="facility" required>{facilities.data!.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
              <Field label={t('bookingsPage.length')}>{(p) => <Select {...p} name="duration" defaultValue="60">{[30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{t('signup.duration', { count: m })}</option>)}</Select>}</Field>
              <Field label={t('programs.price')}>{(p) => <Input {...p} name="price" inputMode="decimal" required placeholder="150.00" />}</Field>
              <Field label={t('bookingsPage.opens')}>{(p) => <Input {...p} name="open" type="time" required defaultValue="09:00" />}</Field>
              <Field label={t('bookingsPage.closes')}>{(p) => <Input {...p} name="close" type="time" required defaultValue="20:00" />}</Field>
              <Field label={t('bookingsPage.lead')}>{(p) => <Input {...p} name="lead" type="number" min={0} max={365} defaultValue={2} />}</Field>
              <Field label={t('bookingsPage.capacity')} hint={t('bookingsPage.capacityHint')}>{(p) => <Input {...p} name="capacity" type="number" min={1} max={50} defaultValue={1} />}</Field>
              <Field label={t('bookingsPage.party')} hint={t('common.optional')}>{(p) => <Input {...p} name="party" type="number" min={1} max={1000} />}</Field>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('programs.days')}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d]))} className={`h-10 min-w-[3rem] rounded-xl border px-2 text-small font-semibold ${days.includes(d) ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted'}`}>{dow(d)}</button>)}
            </div>
            <Button type="submit" loading={busy === 'service'} className="justify-self-start">{t('bookingsPage.addService')}</Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
