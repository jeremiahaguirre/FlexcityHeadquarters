'use client';

import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonLink, Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api';

function ResetForm() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const invite = params.get('invite') === '1';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password'));
    if (password !== String(f.get('confirm'))) return setError(t('reset.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/reset', { method: 'POST', body: { token, password } }, false);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LINK_EXPIRED') setError(t('reset.expired'));
      else if (err instanceof ApiError && err.code === 'PASSWORD_PERSONAL') setError(t('errors.PASSWORD_PERSONAL'));
      else if (err instanceof ApiError && err.status === 400) setError(t('reset.weak'));
      else setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-ok-bg text-ok">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-title">{t('reset.doneTitle')}</h1>
        <ButtonLink href="/login" size="lg" block className="mt-8">
          {t('login.submit')}
        </ButtonLink>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-title">{invite ? t('reset.inviteTitle') : t('reset.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('reset.rule')}</p>
      <form onSubmit={onSubmit} className="mt-8 grid gap-5">
        <Field label={t('reset.password')}>{(p) => <Input {...p} name="password" type="password" autoComplete="new-password" minLength={12} required />}</Field>
        <Field label={t('reset.confirm')} error={error ?? undefined}>
          {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
        </Field>
        <Button type="submit" size="lg" block loading={busy} disabled={!token}>
          {invite ? t('reset.inviteSubmit') : t('reset.submit')}
        </Button>
      </form>
    </>
  );
}

/** Choose a new password from an emailed link (?token=). The same page finishes an invitation (?invite=1). */
export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
