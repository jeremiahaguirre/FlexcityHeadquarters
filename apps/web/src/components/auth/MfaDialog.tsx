'use client';

import { KeyRound, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { api, logout, setMfaHandler } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { addPasskey, cancelled, passkeysSupported, stepUpWithPasskey } from '@/lib/passkeys';
import { PasskeyIcon } from './PasskeyIcon';

/**
 * "Confirm with your passkey": the organization requires a second factor for
 * this account. With a passkey on file, use it; otherwise set one up on this
 * device. The request that needed it then carries on by itself.
 */
export function MfaDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const supported = passkeysSupported();

  useEffect(() => {
    setMfaHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setError(null);
          setHasPasskey(null);
          setOpen(true);
          api<unknown[]>('/api/me/passkeys')
            .then((l) => setHasPasskey(l.length > 0))
            .catch(() => setHasPasskey(false));
        }),
    );
    return () => setMfaHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (hasPasskey) await stepUpWithPasskey();
      else await addPasskey();
      finish(true);
    } catch (e) {
      if (!cancelled(e)) setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('passkeys.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    finish(false);
    await logout();
    window.location.assign('/login');
  }

  return (
    <Dialog open={open} onClose={() => finish(false)} title={t('mfa.title')} description={t('mfa.help')} closeLabel={t('common.cancel')}>
      <div className="grid gap-4">
        {!supported ? (
          <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{t('mfa.unsupported')}</p>
        ) : hasPasskey === null ? null : (
          <>
            {!hasPasskey ? <p className="text-small text-muted">{t('mfa.setUpHelp')}</p> : null}
            <Button size="lg" block icon={hasPasskey ? <PasskeyIcon /> : <KeyRound className="h-5 w-5" aria-hidden="true" />} loading={busy} onClick={() => void go()}>
              {hasPasskey ? t('mfa.use') : t('mfa.setUp')}
            </Button>
          </>
        )}
        <Button variant="ghost" block icon={<LogOut className="h-4 w-4" aria-hidden="true" />} onClick={() => void signOut()}>
          {t('mfa.signOut')}
        </Button>
        <div aria-live="polite">{error ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
      </div>
    </Dialog>
  );
}
