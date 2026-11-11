'use client';

import { CalendarCheck, CheckCircle2, ChevronLeft, Clock, MapPin, Users } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { ApiError, api } from '@/lib/api';
import { ageRange, hhmm, money } from '@/lib/programs';
import { dateFormat, formatInstant, setTimeFormat } from '@/lib/format';

interface PublicSet { id: string; name: string; facility: string; daysOfWeek: number[]; startMinute: number; endMinute: number; startsOn: string; endsOn: string; sessions: number; minAgeMonths: number | null; maxAgeMonths: number | null; priceCents: number | null; spotsLeft: number; majorityAge?: number }
interface Program { id: string; name: string; nameFr: string | null; kind: string; open: boolean; opensAt: string | null; sets: PublicSet[] }
interface Service { id: string; name: string; nameFr: string | null; description: string | null; descriptionFr: string | null; facility: string; durationMinutes: number; priceCents: number; maxPartySize: number | null; daysOfWeek: number[]; leadDays: number; majorityAge?: number }
interface Portal { enabled: boolean; organization?: string; timeFormat?: string; terms?: string; termsFr?: string; payment?: string; paymentFr?: string; privacyContact?: string; programs?: Program[]; services?: Service[] }

/** Public: sign up for programs or request a facility booking. No account needed. */
export default function SignupPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const fr = lng === 'fr-CA';
  const [data, setData] = useState<Portal | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'programs' | 'book'>('programs');
  const [set, setSet] = useState<(PublicSet & { program: string }) | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [done, setDone] = useState<{ reference: string; status?: string; kind: 'program' | 'booking' } | null>(null);
  const load = () => {
    setFailed(false);
    api<Portal>('/api/public/signup', {}, false).then((p) => { setTimeFormat(p.timeFormat); setData(p); }, () => setFailed(true));
  };
  useEffect(load, []);
  const date = (d: string) => formatInstant(d, lng);
  const dow = (d: number) => dateFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
  const pick = (k: string, f: string | null) => (fr && f ? f : k);

  if (failed) return <ErrorNotice onRetry={load} />;
  if (!data) return <ListSkeleton rows={4} />;
  if (!data.enabled) return <EmptyState icon={CalendarCheck} title={t('signup.closed')}>{t('signup.closedHelp')}</EmptyState>;

  if (done) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardBody className="grid gap-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-ok" aria-hidden="true" />
          <h1 className="text-title">{done.kind === 'booking' ? t('signup.bookingSent') : done.status === 'WAITLISTED' ? t('signup.waitlisted') : t('signup.registered')}</h1>
          <p className="text-body">{t('signup.reference')} <span className="font-semibold tabular-nums">{done.reference}</span></p>
          <p className="text-small text-muted">{done.kind === 'booking' ? t('signup.bookingNext') : done.status === 'WAITLISTED' ? t('signup.waitlistNext') : pick(data.payment ?? '', data.paymentFr ?? null) || t('signup.payNext')}</p>
          <p className="text-caption text-muted">{t('signup.emailed')}</p>
          <Button variant="secondary" className="justify-self-center" onClick={() => { setDone(null); setSet(null); setService(null); load(); }}>{t('signup.another')}</Button>
        </CardBody>
      </Card>
    );
  }

  if (set) return <RegistrationForm set={set} portal={data} onBack={() => setSet(null)} onDone={(r) => setDone({ ...r, kind: 'program' })} />;
  if (service) return <BookingForm service={service} portal={data} onBack={() => setService(null)} onDone={(r) => setDone({ ...r, kind: 'booking' })} />;

  return (
    <>
      <h1 className="text-title">{t('signup.title', { org: data.organization })}</h1>
      <p className="mt-2 max-w-prose text-body text-muted">{t('signup.intro')}</p>
      {data.services?.length ? (
        <div className="mt-6 max-w-sm"><Segmented label={t('signup.title', { org: '' })} value={tab} onChange={setTab} options={[{ value: 'programs', label: t('signup.programs') }, { value: 'book', label: t('signup.book') }]} /></div>
      ) : null}
      <div className="mt-6 grid gap-6">
        {tab === 'programs' ? (
          !data.programs?.length ? <EmptyState icon={CalendarCheck} title={t('signup.noPrograms')}>{t('signup.noProgramsHelp')}</EmptyState> : data.programs.map((p) => (
            <section key={p.id} className="grid gap-3">
              <h2 className="text-heading">{pick(p.name, p.nameFr)}</h2>
              {!p.open ? <p className="text-small font-semibold text-warn">{p.opensAt && new Date(p.opensAt) > new Date() ? t('signup.opensOn', { date: dateFormat(lng, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.opensAt)) }) : t('signup.regClosed')}</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {p.sets.map((s) => (
                  <Card key={s.id}>
                    <CardBody className="grid gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-body-strong">{s.name}</p>
                        <p className="text-body-strong tabular-nums">{money(s.priceCents, lng)}</p>
                      </div>
                      <ul className="grid gap-1 text-small text-muted">
                        <li className="flex items-center gap-1.5"><Clock className="h-4 w-4" aria-hidden="true" />{s.daysOfWeek.map(dow).join(' ')} {hhmm(s.startMinute)}–{hhmm(s.endMinute)} · {t('signup.sessions', { count: s.sessions })}</li>
                        <li className="flex items-center gap-1.5"><CalendarCheck className="h-4 w-4" aria-hidden="true" />{date(s.startsOn)} – {date(s.endsOn)}</li>
                        <li className="flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden="true" />{s.facility}</li>
                        <li className="flex items-center gap-1.5"><Users className="h-4 w-4" aria-hidden="true" />{ageRange(s.minAgeMonths, s.maxAgeMonths, t)}</li>
                      </ul>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-caption font-semibold ${s.spotsLeft ? 'text-ok' : 'text-warn'}`}>{s.spotsLeft ? t('signup.spots', { count: s.spotsLeft }) : t('signup.fullWaitlist')}</span>
                        <Button size="sm" disabled={!p.open} onClick={() => setSet({ ...s, program: pick(p.name, p.nameFr) })}>{s.spotsLeft ? t('signup.signUp') : t('signup.joinWaitlist')}</Button>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.services!.map((v) => (
              <Card key={v.id}>
                <CardBody className="grid gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-body-strong">{pick(v.name, v.nameFr)}</p>
                    <p className="text-body-strong tabular-nums">{money(v.priceCents, lng)}</p>
                  </div>
                  {v.description ? <p className="text-small">{pick(v.description, v.descriptionFr)}</p> : null}
                  <p className="text-small text-muted">{v.facility} · {t('signup.duration', { count: v.durationMinutes })}{v.maxPartySize ? ` · ${t('signup.upTo', { count: v.maxPartySize })}` : ''}</p>
                  <Button size="sm" className="justify-self-end" onClick={() => setService(v)}>{t('signup.request')}</Button>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The age gate: the person filling the form confirms they're of the age of majority where the
 * program or facility is (19 in BC, NB, NL, NS, NT, NU, YT; 18 elsewhere), and, for a child,
 * that they're the parent or guardian and consent to the child's information being collected.
 * The API refuses the form without these.
 */
function AgeGate({ majority, child, booking }: { majority: number; child?: boolean; booking?: boolean }) {
  const { t } = useTranslation();
  const box = 'mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]';
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-small font-semibold">{t('signup.ageTitle')}</legend>
      <label className="flex items-start gap-2 text-small"><input type="checkbox" name="adult" required className={box} />{t(booking ? 'signup.adultConfirmBooking' : 'signup.adultConfirm', { age: majority })}</label>
      {child ? <label className="flex items-start gap-2 text-small"><input type="checkbox" name="guardian" required className={box} />{t('signup.guardianConfirm')}</label> : null}
      {child === false ? <p className="text-caption text-muted">{t('signup.minorHelp', { age: majority })}</p> : null}
    </fieldset>
  );
}

function Consents({ portal, photo }: { portal: Portal; photo?: boolean }) {
  const { t, i18n } = useTranslation();
  const terms = i18n.language === 'fr-CA' && portal.termsFr ? portal.termsFr : portal.terms;
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-small font-semibold">{t('signup.agreements')}</legend>
      <div className="max-h-40 overflow-y-auto whitespace-pre-line rounded-xl border border-line bg-surface p-3 text-caption">{terms}</div>
      <label className="flex items-start gap-2 text-small"><input type="checkbox" name="terms" required className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />{t('signup.agreeTerms')}</label>
      <label className="flex items-start gap-2 text-small"><input type="checkbox" name="privacy" required className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span>{t('signup.agreePrivacy', { org: portal.organization })}{portal.privacyContact ? <span className="block text-caption text-muted">{t('signup.privacyContact', { contact: portal.privacyContact })}</span> : null}</span></label>
      {photo ? <label className="flex items-start gap-2 text-small"><input type="checkbox" name="photo" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />{t('signup.agreePhoto')}</label> : null}
    </fieldset>
  );
}

/** A field bots see and fill in; people never do. */
const Trap = () => (
  <div aria-hidden="true" className="absolute -left-[10000px] h-0 w-0 overflow-hidden">
    <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
  </div>
);

function useSubmit(onDone: (r: { reference: string; status?: string }) => void) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());
  const submit = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api<{ reference: string; status?: string }>(path, { method: 'POST', body: { ...body, startedAt: started.current } }, false));
    } catch (e) {
      setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };
  return { submit, busy, error };
}

function RegistrationForm({ set, portal, onBack, onDone }: { set: PublicSet & { program: string }; portal: Portal; onBack: () => void; onDone: (r: { reference: string; status?: string }) => void }) {
  const { t, i18n } = useTranslation();
  const [self, setSelf] = useState(false);
  const { submit, busy, error } = useSubmit(onDone);
  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const guardian = { firstName: s('gFirst'), lastName: s('gLast'), email: s('email'), phone: s('phone') };
    void submit('/api/public/registrations', {
      setId: set.id,
      website: s('website'),
      guardian,
      address: s('address'),
      emergency: { name: s('emName'), phone: s('emPhone') },
      participant: self ? { firstName: guardian.firstName, lastName: guardian.lastName, dateOfBirth: s('dob'), safetyNote: s('note'), self: true } : { firstName: s('pFirst'), lastName: s('pLast') || guardian.lastName, dateOfBirth: s('dob'), safetyNote: s('note') },
      consents: { terms: f.get('terms') === 'on', privacy: f.get('privacy') === 'on', photo: f.get('photo') === 'on', adult: f.get('adult') === 'on', guardian: !self && f.get('guardian') === 'on' },
      locale: i18n.language,
    });
  }
  return (
    <div className="grid gap-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 justify-self-start text-small font-semibold text-brand-text hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('signup.back')}</button>
      <div>
        <h1 className="text-title">{t('signup.registerFor', { set: set.name })}</h1>
        <p className="mt-1 text-small text-muted">{set.program} · {set.facility} · {money(set.priceCents, i18n.language)} · {ageRange(set.minAgeMonths, set.maxAgeMonths, t)}</p>
        {!set.spotsLeft ? <p className="mt-2 text-small font-semibold text-warn">{t('signup.waitlistNote')}</p> : null}
      </div>
      <form className="relative grid gap-6" onSubmit={send}>
        <Trap />
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="text-heading">{t('signup.yourDetails')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('signup.firstName')}>{(p) => <Input {...p} name="gFirst" required maxLength={60} autoComplete="given-name" />}</Field>
              <Field label={t('signup.lastName')}>{(p) => <Input {...p} name="gLast" required maxLength={60} autoComplete="family-name" />}</Field>
              <Field label={t('signup.email')} hint={t('signup.emailHint')}>{(p) => <Input {...p} name="email" type="email" required maxLength={160} autoComplete="email" />}</Field>
              <Field label={t('signup.phone')}>{(p) => <Input {...p} name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" />}</Field>
            </div>
            <Field label={t('signup.address')} hint={t('common.optional')}>{(p) => <Input {...p} name="address" maxLength={200} autoComplete="street-address" />}</Field>
            <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('signup.forMyself')}</label>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="text-heading">{self ? t('signup.aboutYou') : t('signup.participant')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {!self ? (
                <>
                  <Field label={t('signup.firstName')}>{(p) => <Input {...p} name="pFirst" required maxLength={60} />}</Field>
                  <Field label={t('signup.lastName')} hint={t('signup.lastHint')}>{(p) => <Input {...p} name="pLast" maxLength={60} />}</Field>
                </>
              ) : null}
              <Field label={t('signup.dob')} hint={t('signup.dobHint')}>{(p) => <Input {...p} name="dob" type="date" required />}</Field>
            </div>
            <Field label={t('signup.safety')} hint={t('signup.safetyHint')}>{(p) => <Textarea {...p} name="note" maxLength={200} rows={2} />}</Field>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="text-heading">{t('signup.emergency')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('signup.emergencyName')} hint={t('signup.emergencyHint')}>{(p) => <Input {...p} name="emName" required minLength={2} maxLength={80} />}</Field>
              <Field label={t('signup.phone')}>{(p) => <Input {...p} name="emPhone" type="tel" required minLength={7} maxLength={30} />}</Field>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-5"><AgeGate majority={set.majorityAge ?? 19} child={!self} /><Consents portal={portal} photo /></CardBody>
        </Card>
        <div aria-live="polite">{error ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
        <Button type="submit" size="lg" loading={busy} className="justify-self-start">{set.spotsLeft ? t('signup.submit') : t('signup.joinWaitlist')}</Button>
      </form>
    </div>
  );
}

function BookingForm({ service, portal, onBack, onDone }: { service: Service; portal: Portal; onBack: () => void; onDone: (r: { reference: string }) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const earliest = new Date(Date.now() + service.leadDays * 86_400_000).toISOString().slice(0, 10);
  const [day, setDay] = useState(earliest);
  const [slots, setSlots] = useState<Array<{ startMinute: number }> | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const { submit, busy, error } = useSubmit(onDone);
  useEffect(() => {
    setSlots(null);
    setSlot(null);
    api<Array<{ startMinute: number }>>(`/api/public/services/${service.id}/slots?date=${day}`, {}, false).then(setSlots, () => setSlots([]));
  }, [day, service.id]);
  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    void submit('/api/public/bookings', {
      serviceId: service.id, date: day, startMinute: slot, website: s('website'),
      partySize: s('party') ? Number(s('party')) : undefined,
      contact: { name: s('name'), email: s('email'), phone: s('phone') }, organization: s('org'), notes: s('notes'),
      consents: { terms: f.get('terms') === 'on', privacy: f.get('privacy') === 'on', adult: f.get('adult') === 'on' }, locale: lng,
    });
  }
  const name = lng === 'fr-CA' && service.nameFr ? service.nameFr : service.name;
  return (
    <div className="grid gap-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 justify-self-start text-small font-semibold text-brand-text hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('signup.back')}</button>
      <div>
        <h1 className="text-title">{t('signup.bookTitle', { service: name })}</h1>
        <p className="mt-1 text-small text-muted">{service.facility} · {money(service.priceCents, lng)} · {t('signup.duration', { count: service.durationMinutes })}</p>
      </div>
      <form className="relative grid gap-6" onSubmit={send}>
        <Trap />
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="text-heading">{t('signup.when')}</h2>
            <Field label={t('signup.date')} hint={t('signup.leadHint', { count: service.leadDays })}>{(p) => <Input {...p} type="date" min={earliest} value={day} onChange={(e) => setDay(e.target.value)} required />}</Field>
            {!slots ? <ListSkeleton rows={1} /> : !slots.length ? <p className="text-small text-muted">{t('signup.noSlots')}</p> : (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('signup.time')}>
                {slots.map((s) => (
                  <button key={s.startMinute} type="button" role="radio" aria-checked={slot === s.startMinute} onClick={() => setSlot(s.startMinute)} className={`h-11 rounded-xl border px-4 text-small font-semibold tabular-nums ${slot === s.startMinute ? 'border-brand bg-brand/10 text-brand-text' : 'border-line hover:bg-surface'}`}>
                    {hhmm(s.startMinute)}–{hhmm(s.startMinute + service.durationMinutes)}
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="text-heading">{t('signup.yourDetails')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('signup.fullName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} autoComplete="name" />}</Field>
              <Field label={t('signup.org')} hint={t('common.optional')}>{(p) => <Input {...p} name="org" maxLength={120} />}</Field>
              <Field label={t('signup.email')}>{(p) => <Input {...p} name="email" type="email" required maxLength={160} autoComplete="email" />}</Field>
              <Field label={t('signup.phone')}>{(p) => <Input {...p} name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" />}</Field>
              <Field label={t('signup.party')} hint={service.maxPartySize ? t('signup.upTo', { count: service.maxPartySize }) : undefined}>{(p) => <Input {...p} name="party" type="number" min={1} max={service.maxPartySize ?? 1000} />}</Field>
            </div>
            <Field label={t('signup.notes')} hint={t('signup.notesHint')}>{(p) => <Textarea {...p} name="notes" maxLength={1000} rows={3} />}</Field>
          </CardBody>
        </Card>
        <Card><CardBody className="grid gap-5"><AgeGate majority={service.majorityAge ?? 19} booking /><Consents portal={portal} /></CardBody></Card>
        <div aria-live="polite">{error ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
        <Button type="submit" size="lg" loading={busy} disabled={slot === null} className="justify-self-start">{t('signup.sendRequest')}</Button>
      </form>
    </div>
  );
}
