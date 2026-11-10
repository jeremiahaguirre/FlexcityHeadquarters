'use client';

import { Bell, Check, FileSignature, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copyright } from '@/components/Copyright';
import { Logo } from '@/components/Logo';
import { SignaturePad } from '@/components/SignaturePad';
import { Button } from '@/components/ui/Button';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { api } from '@/lib/api';
import { enablePush } from '@/lib/device';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';

type Choice = 'granted' | 'denied' | 'skipped' | 'unsupported';
interface Agreement { title: string; intro: string; sections: Array<{ heading: string; body: string[] }>; confirm: string }
interface Consent { required: boolean; version: string; locale: string; agreement: Agreement }

/** Asks the browser for location once (to show the prompt); the position itself is never sent. */
function askLocation(): Promise<Choice> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve('unsupported');
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (e) => resolve(e.code === e.PERMISSION_DENIED ? 'denied' : 'granted'),
      { timeout: 15000, maximumAge: 600000 },
    ),
  );
}

/**
 * The first-sign-in agreement: what's collected, the two optional permissions (asked right
 * here, so the phone's own prompts appear), a typed name and a signature. Nothing else in the
 * app opens until it's signed; a new version is signed again.
 */
export function ConsentGate() {
  const { t, i18n } = useTranslation();
  const { reload, signOut } = useSession();
  const [data, setData] = useState<Consent | null>(null);
  const [failed, setFailed] = useState(false);
  const [notifications, setNotifications] = useState<Choice>('skipped');
  const [location, setLocation] = useState<Choice>('skipped');
  const [asking, setAsking] = useState<'n' | 'l' | null>(null);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    api<Consent>(`/api/me/consent?lang=${i18n.language}`).then(setData, () => setFailed(true));
  };
  useEffect(load, [i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!data || !signature || name.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/me/consent', { method: 'POST', body: { version: data.version, locale: data.locale, name: name.trim(), signature, choices: { notifications, location } } });
      await reload();
    } catch {
      setError(t('consent.failed'));
      setSaving(false);
    }
  };

  const permission = (kind: 'n' | 'l', value: Choice, ask: () => Promise<Choice>, set: (c: Choice) => void) => {
    const Icon = kind === 'n' ? Bell : MapPin;
    const key = kind === 'n' ? 'notifications' : 'location';
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand-text"><Icon className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t(`consent.${key}.title`)}</p>
          <p className="text-small text-muted">{t(`consent.${key}.body`)}</p>
          <p className="mt-1 text-caption font-semibold" aria-live="polite">{t(`consent.state.${value}`)}</p>
        </div>
        <Button
          size="sm"
          variant={value === 'granted' ? 'secondary' : 'primary'}
          loading={asking === kind}
          disabled={value === 'granted' || value === 'unsupported'}
          icon={value === 'granted' ? <Check className="h-4 w-4" aria-hidden="true" /> : undefined}
          onClick={async () => {
            setAsking(kind);
            set(await ask());
            setAsking(null);
          }}
        >
          {value === 'granted' ? t('consent.allowed') : t('consent.allow')}
        </Button>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-page">
      <main id="main" className="mx-auto grid max-w-2xl gap-8 px-4 pb-16 pt-10 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <Logo size={34} />
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>{t('shell.signOut')}</Button>
        </div>
        {failed ? <ErrorNotice onRetry={load} /> : !data ? (
          <div className="grid place-items-center py-24"><Spinner className="h-6 w-6" /></div>
        ) : (
          <>
            <header>
              <p className="text-label uppercase text-brand-text">{t('consent.kicker')}</p>
              <h1 className="mt-2 text-display [text-wrap:balance]">{data.agreement.title}</h1>
              <p className="mt-3 text-muted">{data.agreement.intro}</p>
            </header>
            <section aria-label={t('consent.textLabel')} className="grid gap-5 rounded-2xl border border-line bg-panel p-5 shadow-card md:p-6">
              {data.agreement.sections.map((s) => (
                <div key={s.heading}>
                  <h2 className="text-subheading">{s.heading}</h2>
                  <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-small leading-6 text-muted">
                    {s.body.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              ))}
            </section>
            <section aria-labelledby="consent-choices">
              <h2 id="consent-choices" className="text-heading">{t('consent.choices')}</h2>
              <p className="mt-1 text-small text-muted">{t('consent.choicesHelp')}</p>
              <ul className="mt-4 grid gap-3">
                {permission('n', notifications, async () => {
                  const s = await enablePush();
                  return s === 'on' ? 'granted' : s === 'blocked' || s === 'off' ? 'denied' : 'unsupported';
                }, setNotifications)}
                {permission('l', location, askLocation, setLocation)}
              </ul>
            </section>
            <section aria-labelledby="consent-sign" className="grid gap-4 rounded-2xl border border-line bg-panel p-5 shadow-card md:p-6">
              <h2 id="consent-sign" className="flex items-center gap-2 text-heading"><FileSignature className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('consent.sign')}</h2>
              <p className="text-small font-semibold">{data.agreement.confirm}</p>
              <Field label={t('consent.name')}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />}</Field>
              <SignaturePad onChange={setSignature} />
              {error ? <p role="alert" className="text-small font-semibold text-danger">{error}</p> : null}
              <Button block loading={saving} disabled={!signature || name.trim().length < 2} onClick={() => void submit()}>{t('consent.submit')}</Button>
              <p className={cn('text-caption text-muted')}>{t('consent.record', { version: data.version })}</p>
            </section>
            <Copyright className="text-center" />
          </>
        )}
      </main>
    </div>
  );
}
