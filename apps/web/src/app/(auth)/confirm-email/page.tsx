'use client';

import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ApiError, api } from '@/lib/api';

function ConfirmEmail() {
  const { t } = useTranslation();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState('busy');
    setError(null);
    try {
      await api('/api/auth/email-change/confirm', { method: 'POST', body: { token } }, false);
      setState('done');
    } catch (err) {
      setState('idle');
      if (err instanceof ApiError && err.code === 'LINK_EXPIRED') setError(t('confirmEmail.expired'));
      else if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') setError(t('confirmEmail.taken'));
      else if (err instanceof ApiError && err.status === 429) setError(t('errors.TOO_MANY_ATTEMPTS'));
      else setError(t('common.error'));
    }
  }

  if (state === 'done') {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-ok-bg text-ok">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-title">{t('confirmEmail.doneTitle')}</h1>
        <p className="mt-2 text-body text-muted">{t('confirmEmail.doneBody')}</p>
        <ButtonLink href="/login" size="lg" block className="mt-8">
          {t('login.submit')}
        </ButtonLink>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-title">{t('confirmEmail.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('confirmEmail.body')}</p>
      {error ? (
        <p role="alert" className="mt-4 text-small text-danger">
          {error}
        </p>
      ) : null}
      {/* A button, not on page load: mail scanners that open links don't confirm on the person's behalf. */}
      <Button type="button" size="lg" block className="mt-8" loading={state === 'busy'} disabled={!token} onClick={() => void confirm()}>
        {t('confirmEmail.submit')}
      </Button>
    </>
  );
}

/** Confirms a new sign-in email from the link sent to it (?token=). */
export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmail />
    </Suspense>
  );
}
