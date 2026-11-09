'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, login } from '@/lib/api';
import { DEMO, DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/demo';

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get('email')), String(form.get('password')));
      router.push('/board');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('login.invalid') : t('board.error'));
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full rounded-md border border-line bg-transparent px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

  return (
    <section className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">{t('login.title')}</h1>
      {DEMO ? (
        <p className="mb-4 rounded-md bg-surface px-3 py-2 text-sm">
          {t('demo.hint', { accounts: DEMO_ACCOUNTS.join(', '), password: DEMO_PASSWORD })}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <label className="block">
          <span className="text-sm font-medium">{t('login.email')}</span>
          <input name="email" type="email" autoComplete="username" required className={field} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t('login.password')}</span>
          <input name="password" type="password" autoComplete="current-password" required className={field} />
        </label>
        <div aria-live="polite">{error ? <p className="text-sm text-danger">{error}</p> : null}</div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand px-4 py-2 font-medium text-brand-contrast hover:bg-brand-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {busy ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </section>
  );
}
