'use client';

import { ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { api, setStepUpHandler } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { cancelled, passkeysSupported, stepUpWithPasskey, stepUpWithPassword } from '@/lib/passkeys';
import { PasskeyIcon } from './PasskeyIcon';

/**
 * "Confirm it's you": sensitive actions (payroll, pay rates, roles, passkeys)
 * need a recent sign-in. The request pauses here, then carries on by itself.
 */
export function StepUpDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [busy, setBusy] = useState<'passkey' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setError(null);
          setOpen(true);
          if (passkeysSupported()) {
            api<unknown[]>('/api/me/passkeys')
              .then((l) => setHasPasskey(l.length > 0))
              .catch(() => setHasPasskey(false));
          }
        }),
    );
    return () => setStepUpHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  async function withPasskey() {
    setBusy('passkey');
    setError(null);
    try {
      await stepUpWithPasskey();
      finish(true);
    } catch (e) {
      if (!cancelled(e)) setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('passkeys.failed'));
    } finally {
      setBusy(null);
    }
  }

  async function withPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      await stepUpWithPassword(String(new FormData(e.currentTarget).get('password')));
      finish(true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'WRONG_PASSWORD' ? t('errors.WRONG_PASSWORD') : t('common.error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={() => finish(false)} title={t('passkeys.confirmTitle')} description={t('passkeys.confirmHelp')} closeLabel={t('common.cancel')}>
      <div className="grid gap-5">
        {hasPasskey ? (
          <Button size="lg" block icon={<PasskeyIcon />} loading={busy === 'passkey'} onClick={() => void withPasskey()}>
            {t('passkeys.confirmWithPasskey')}
          </Button>
        ) : null}
        <form onSubmit={(e) => void withPassword(e)} className="grid gap-3">
          <Field label={t('login.password')}>{(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required autoFocus={!hasPasskey} />}</Field>
          <Button type="submit" variant={hasPasskey ? 'secondary' : 'primary'} block loading={busy === 'password'} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
            {t('passkeys.confirmWithPassword')}
          </Button>
        </form>
        <div aria-live="polite">{error ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
      </div>
    </Dialog>
  );
}
