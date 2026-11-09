'use client';

import { LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ApiError, login } from '@/lib/api';
import { DEMO, DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_ROLES } from '@/lib/demo';
import { OFFER_FLAG } from '@/components/auth/PasskeyPrompt';
import { PasskeyIcon } from '@/components/auth/PasskeyIcon';
import { cancelled, passkeysSupported, signInWithPasskey } from '@/lib/passkeys';

function LoginForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => setCanPasskey(passkeysSupported()), []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await signIn(String(form.get('email')), String(form.get('password')));
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      if (!cancelled(err)) setError(err instanceof ApiError && err.code === 'PASSKEY_UNKNOWN' ? t('passkeys.unknown') : t('passkeys.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(email: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      try {
        sessionStorage.setItem(OFFER_FLAG, '1'); // offer Face ID / fingerprint / Windows Hello next
      } catch {
        /* storage blocked */
      }
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('login.invalid'));
      else if (err instanceof ApiError && err.status === 423) setError(t('login.locked'));
      else if (err instanceof ApiError && err.status === 429) setError(t('login.tooMany'));
      else setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-title">{t('login.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('login.subtitle')}</p>
      {DEMO ? (
        <div className="mt-6 grid gap-2">
          <p className="text-small font-semibold">{t('demo.pick')}</p>
          {DEMO_ACCOUNTS.map((a) => (
            <Button key={a} variant="secondary" block disabled={busy} onClick={() => void signIn(a, DEMO_PASSWORD)} className="justify-start">
              {t(`roles.${DEMO_ROLES[a]}`)}
            </Button>
          ))}
          <p className="mt-2 text-caption text-muted">{t('demo.hint', { password: DEMO_PASSWORD })}</p>
          <Link href="/platform/login" className="mt-1 text-small font-semibold text-brand-text hover:underline">
            {t('demo.devConsole')}
          </Link>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
        <Field label={t('login.email')}>{(p) => <Input {...p} name="email" type="email" autoComplete="username" required />}</Field>
        <Field label={t('login.password')}>{(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}</Field>
        <div aria-live="polite">{error ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
        <Button type="submit" size="lg" block loading={busy} icon={<LogIn className="h-5 w-5" aria-hidden="true" />}>
          {busy ? t('login.submitting') : t('login.submit')}
        </Button>
        {canPasskey ? (
          <Button variant="secondary" size="lg" block disabled={busy} icon={<PasskeyIcon />} onClick={() => void withPasskey()}>
            {t('passkeys.signIn')}
          </Button>
        ) : null}
        {DEMO ? null : (
          <Link href="/forgot" className="justify-self-center rounded-lg text-small font-semibold text-brand-text hover:underline">
            {t('login.forgot')}
          </Link>
        )}
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
