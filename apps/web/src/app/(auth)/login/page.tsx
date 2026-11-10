'use client';

import { Building2, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ApiError, login, signInInfo, type SsoInfo } from '@/lib/api';
import { DEMO, DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_ROLES } from '@/lib/demo';
import { OFFER_FLAG } from '@/components/auth/PasskeyPrompt';
import { PasskeyIcon } from '@/components/auth/PasskeyIcon';
import { cancelled, passkeysSupported, signInWithPasskey } from '@/lib/passkeys';

function LoginForm() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => setCanPasskey(passkeysSupported()), []);
  const [sso, setSso] = useState<SsoInfo | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [closed, setClosed] = useState<{ exportUntil: string | null } | null>(null);
  useEffect(
    () =>
      void signInInfo().then((i) => {
        setSso(i.sso);
        setClosed(i.closed);
      }),
    [],
  );
  // Back from the identity provider with a problem: say what it was.
  const ssoError = params.get('sso');
  useEffect(() => {
    if (ssoError) setError(t([`login.ssoErrors.${ssoError}`, 'login.ssoErrors.generic']));
  }, [ssoError, t]);
  const ssoHref = () => {
    const next = params.get('next');
    return `/api/auth/sso/start${next && next.startsWith('/') && !next.startsWith('//') ? `?next=${encodeURIComponent(next)}` : ''}`;
  };
  const passwordHidden = !!sso?.enforced && !showPassword;
  // The marketing site links straight into a role: /login?as=AQUATIC_SUPERVISOR.
  const as = DEMO ? params.get('as') : null;
  useEffect(() => {
    const account = as ? DEMO_ACCOUNTS.find((a) => DEMO_ROLES[a] === as) : undefined;
    if (account) void signIn(account, DEMO_PASSWORD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [as]);

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
      const next = closed ? '/export' : params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ORG_DISABLED') setError(t('login.closedNoAccess'));
      else if (err instanceof ApiError && err.status === 401) setError(t('login.invalid'));
      else if (err instanceof ApiError && err.status === 423) setError(t('login.locked'));
      else if (err instanceof ApiError && err.status === 429) setError(t('login.tooMany'));
      else if (err instanceof ApiError && err.code === 'SSO_REQUIRED') setError(t('login.ssoErrors.SSO_REQUIRED'));
      else setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-title">{t('login.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('login.subtitle')}</p>
      {closed ? (
        <p className="mt-4 rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">
          {closed.exportUntil ? t('login.closedExport', { date: new Date(closed.exportUntil).toLocaleDateString(i18n.language, { dateStyle: 'long' }) }) : t('login.closedNoAccess')}
        </p>
      ) : null}
      {DEMO ? (
        <div className="mt-6 grid gap-2">
          <p className="text-small font-semibold">{t('demo.pick')}</p>
          {DEMO_ACCOUNTS.map((a) => (
            <Button key={a} variant="secondary" block disabled={busy} onClick={() => void signIn(a, DEMO_PASSWORD)} className="justify-start">
              {t(`roles.${DEMO_ROLES[a]}`)}
            </Button>
          ))}
          <p className="mt-2 text-caption text-muted">{t('demo.hint', { password: DEMO_PASSWORD })}</p>
        </div>
      ) : null}
      {sso ? (
        <div className="mt-8 grid gap-3">
          <Button size="lg" block icon={<Building2 className="h-5 w-5" aria-hidden="true" />} onClick={() => window.location.assign(ssoHref())}>
            {sso.label ? t('login.ssoWith', { name: sso.label }) : t('login.ssoOrg')}
          </Button>
          {passwordHidden ? (
            <>
              <div aria-live="polite">{error ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
              <button type="button" className="justify-self-center rounded-lg text-small font-semibold text-muted hover:text-ink hover:underline" onClick={() => setShowPassword(true)}>{t('login.adminPassword')}</button>
            </>
          ) : (
            <p className="flex items-center gap-3 text-caption uppercase tracking-wide text-muted"><span className="h-px flex-1 bg-line" />{t('login.or')}<span className="h-px flex-1 bg-line" /></p>
          )}
        </div>
      ) : null}
      {passwordHidden ? null : (
      <form onSubmit={onSubmit} className={sso ? 'mt-3 grid gap-5' : 'mt-8 grid gap-5'} noValidate>
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
      )}
      <p className="mt-8 border-t border-line pt-5 text-center text-small text-muted">
        {t('login.notStaff')}{' '}
        <Link href="/signup" className="font-semibold text-brand-text hover:underline">{t('login.signupLink')}</Link>
      </p>
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
