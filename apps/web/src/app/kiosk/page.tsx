'use client';

import { Delete, LogIn, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { dateFormat } from '@/lib/format';
import { CLIENT_HEADERS, markOutdated, noteServerVersion, setBusy as setUpdateBusy } from '@/lib/appUpdate';

/**
 * The shared tablet at a facility. Set up once from the link a supervisor makes:
 * its secret arrives after the #, is handed to the server, which keeps it in an
 * HttpOnly cookie on this tablet (no script can read it), and is removed from
 * the address bar. The page itself stores no secret. Staff type their employee number and PIN to punch in
 * or out. No one signs in, and nothing about anyone stays on screen.
 */
/** Where tablets paired before the cookie kept their secret: moved to the cookie, then deleted. */
const LEGACY_KEY = 'fh-kiosk-token';
interface Info { kiosk: string; facility: string; organization: string; timezone: string; locale: string }
type Result = { action: 'IN' | 'OUT'; name: string; at: string; scheduled?: boolean } | { error: string };

async function call<T>(path: string, body?: object): Promise<{ ok: boolean; status: number; data: T & { code?: string; message?: string } }> {
  // The cookie identifies the tablet; the header proves the request comes from this page.
  const r = await fetch(`/api${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { ...CLIENT_HEADERS, 'x-fh-kiosk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  // A newer build out? The tablet refreshes itself between punches (components/AppUpdates.tsx).
  noteServerVersion(r.headers.get('x-fh-version'));
  // Too old for the API: say so on screen, then refresh as soon as the keypad is free.
  if (r.status === 426) markOutdated();
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

export default function KioskPage() {
  const { t, i18n } = useTranslation();
  /** null while pairing; true once the server holds this tablet's cookie (or held it already). */
  const [paired, setPaired] = useState<boolean | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<'number' | 'pin'>('number');
  const [number, setNumber] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [now, setNow] = useState(new Date());
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mid-entry (a number or PIN typed, a punch on its way, its result on screen): never refresh for a new version.
  useEffect(() => setUpdateBusy('kiosk', !!number || !!pin || step === 'pin' || busy || !!result), [number, pin, step, busy, result]);

  useEffect(() => {
    // A secret from the setup link, or one an older version kept in this tablet's storage.
    let secret: string | null = window.location.hash.slice(1) || null;
    if (secret) history.replaceState(null, '', window.location.pathname);
    try {
      secret ??= localStorage.getItem(LEGACY_KEY);
    } catch {
      /* storage blocked: nothing to move */
    }
    const pair = secret
      ? call('/kiosk/pair', { token: secret }).then((r) => {
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {
            /* nothing stored */
          }
          return r.ok;
        })
      : Promise.resolve(true);
    // Without a new secret, the cookie from an earlier pairing (if any) is checked by GET /kiosk.
    void pair.then(setPaired);
    const tick = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!paired) {
      if (paired === false) setProblem('KIOSK_UNKNOWN');
      return;
    }
    void call<Info>('/kiosk').then((r) => {
      if (r.ok) {
        setInfo(r.data);
        setProblem(null);
      } else setProblem(r.data.code ?? 'KIOSK_UNKNOWN');
    });
  }, [paired]);

  const clear = () => {
    setNumber('');
    setPin('');
    setStep('number');
  };
  const press = (d: string) => {
    if (result) setResult(null);
    if (step === 'number') setNumber((n) => (n.length < 12 ? n + d : n));
    else setPin((p) => (p.length < 6 ? p + d : p));
  };
  const back = () => (step === 'number' ? setNumber((n) => n.slice(0, -1)) : pin ? setPin((p) => p.slice(0, -1)) : setStep('number'));

  async function go() {
    if (step === 'number') {
      if (number) setStep('pin');
      return;
    }
    if (pin.length < 4 || !info) return;
    setBusy(true);
    const r = await call<{ action: 'IN' | 'OUT'; name: string; at: string; scheduled?: boolean }>('/kiosk/punch', { employeeNumber: number, pin });
    setBusy(false);
    clear();
    setResult(r.ok ? r.data : { error: r.data.code ?? 'ERROR' });
    if (reset.current) clearTimeout(reset.current);
    reset.current = setTimeout(() => setResult(null), 6000);
  }

  const lng = i18n.language;
  const clock = info ? dateFormat(lng, { timeZone: info.timezone, hour: 'numeric', minute: '2-digit' }).format(now) : '';
  const day = info ? dateFormat(lng, { timeZone: info.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(now) : '';

  // Pairing or loading: a quiet blank page, never a flash of "not set up".
  if (!info && !problem) {
    return <main id="main" className="min-h-screen bg-page" aria-busy="true" />;
  }
  if (!info || problem) {
    return (
      <main id="main" className="grid min-h-screen place-items-center bg-page p-6 text-center">
        <div className="grid max-w-md justify-items-center gap-4">
          <Logo size={40} />
          <h1 className="text-title text-ink">{t('kiosk.notSetUp')}</h1>
          <p className="text-body text-muted">{problem === 'KIOSK_OFF' ? t('kiosk.off') : t('kiosk.notSetUpHelp')}</p>
        </div>
      </main>
    );
  }

  const shown = step === 'number' ? number : '•'.repeat(pin.length);
  return (
    <main id="main" className="grid min-h-screen grid-rows-[auto_1fr] bg-page">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-[max(16px,env(safe-area-inset-left))] py-3">
        <div className="flex items-center gap-3"><Logo size={28} /><div><p className="text-body-strong text-ink">{info?.facility}</p><p className="text-caption text-muted">{info?.organization}</p></div></div>
        <div className="text-right"><p className="text-title tabular-nums text-ink">{clock}</p><p className="text-caption text-muted">{day}</p></div>
        <button type="button" lang={lng === 'fr-CA' ? 'en' : 'fr'} className="min-h-[44px] px-2 text-small font-semibold text-brand-text underline-offset-2 hover:underline" onClick={() => void i18n.changeLanguage(lng === 'fr-CA' ? 'en-CA' : 'fr-CA')}>{lng === 'fr-CA' ? 'English' : 'Français'}</button>
      </header>
      <div className="mx-auto grid w-full max-w-sm content-center gap-5 p-4">
        <div aria-live="polite" className="min-h-[5.5rem]">
          {result ? (
            'error' in result ? (
              <p className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-center text-body-strong text-ink">{t(`kiosk.errors.${result.error}`, { defaultValue: t('kiosk.errors.ERROR') })}</p>
            ) : (
              <p className={`rounded-2xl p-4 text-center text-body-strong ${result.action === 'IN' ? 'bg-ok/15 text-ink' : 'bg-brand/10 text-ink'}`}>
                {result.action === 'IN' ? t('kiosk.in', { name: result.name, time: dateFormat(lng, { timeZone: info?.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(result.at)) }) : t('kiosk.out', { name: result.name, time: dateFormat(lng, { timeZone: info?.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(result.at)) })}
                {result.action === 'IN' && !result.scheduled ? <span className="mt-1 block text-small font-normal text-muted">{t('kiosk.unscheduled')}</span> : null}
              </p>
            )
          ) : (
            <p className="text-center text-body text-muted">{step === 'number' ? t('kiosk.enterNumber') : t('kiosk.enterPin')}</p>
          )}
        </div>
        <output aria-label={step === 'number' ? t('kiosk.number') : t('kiosk.pin')} className="block h-16 rounded-2xl border border-line bg-panel text-center text-[2rem] leading-[4rem] tracking-[0.3em] tabular-nums text-ink">{shown || ' '}</output>
        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" onClick={() => press(d)} className="h-16 rounded-2xl border border-line bg-panel text-[1.75rem] font-semibold text-ink active:scale-[0.97]">{d}</button>
          ))}
          <button type="button" onClick={back} aria-label={t('kiosk.back')} className="grid h-16 place-items-center rounded-2xl border border-line bg-surface text-ink"><Delete className="h-6 w-6" aria-hidden="true" /></button>
          <button type="button" onClick={() => press('0')} className="h-16 rounded-2xl border border-line bg-panel text-[1.75rem] font-semibold text-ink active:scale-[0.97]">0</button>
          <Button size="lg" className="h-16" loading={busy} onClick={() => void go()} icon={step === 'number' ? <LogIn className="h-5 w-5" aria-hidden="true" /> : <LogOut className="h-5 w-5" aria-hidden="true" />}>{step === 'number' ? t('kiosk.next') : t('kiosk.punch')}</Button>
        </div>
        <p className="text-center text-caption text-muted">{t('kiosk.foot')}</p>
      </div>
    </main>
  );
}
