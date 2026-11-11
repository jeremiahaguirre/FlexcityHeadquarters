'use client';

import { CheckCircle2, MailX } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { Button } from '@/components/ui/Button';

/**
 * Where the unsubscribe link in FH commercial email lands (CASL s. 11): no sign-in, the signed
 * token names the address. One button, effective immediately (apps/api/src/routes/emailPrefs.ts).
 * Service messages from an organization (shifts, pay, safety) aren't affected.
 */
function Unsubscribe() {
  const { t, i18n } = useTranslation();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<{ email?: string; unsubscribed?: boolean; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
  useEffect(() => {
    if (!token) return setState({ error: true });
    void fetch(url, { credentials: 'omit' })
      .then(async (r) => (r.ok ? setState((await r.json()) as { email: string; unsubscribed: boolean }) : setState({ error: true })))
      .catch(() => setState({ error: true }));
  }, [token, url]);
  async function confirm() {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: i18n.language }) });
      setState(r.ok ? ((await r.json()) as { email: string; unsubscribed: boolean }) : { error: true });
    } catch {
      setState({ error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-page px-4 py-10">
      <div className="grid w-full max-w-md gap-5 rounded-2xl border border-line bg-panel p-6 shadow-card">
        <div className="flex items-center justify-between gap-3"><Logo size={32} /><AuthLanguageSwitch /></div>
        <h1 className="flex items-center gap-2 text-title">{state?.unsubscribed ? <CheckCircle2 className="h-6 w-6 text-ok" aria-hidden="true" /> : <MailX className="h-6 w-6 text-brand-text" aria-hidden="true" />}{state?.unsubscribed ? t('unsubscribe.done') : t('unsubscribe.title')}</h1>
        <div aria-live="polite" className="grid gap-4">
          {!state ? <p className="text-body text-muted">{t('common.loading')}</p> : state.error ? (
            <p className="text-body text-danger">{t('unsubscribe.invalid')}</p>
          ) : state.unsubscribed ? (
            <p className="text-body text-muted">{t('unsubscribe.doneHelp', { email: state.email })}</p>
          ) : (
            <>
              <p className="text-body text-muted">{t('unsubscribe.help', { email: state.email })}</p>
              <Button size="lg" loading={busy} onClick={() => void confirm()} className="justify-self-start">{t('unsubscribe.confirm', { email: state.email })}</Button>
            </>
          )}
          <p className="text-caption text-muted">{t('unsubscribe.service')}</p>
        </div>
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <Unsubscribe />
    </Suspense>
  );
}
