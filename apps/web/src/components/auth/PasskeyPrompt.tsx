'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { cancelled, deviceCanUsePasskeys } from '@/lib/passkeys';
import { PasskeyIcon } from './PasskeyIcon';

export const OFFER_FLAG = 'fh-offer-passkey';
const dismissedKey = (id: string) => `fh-passkey-dismissed:${id}`;

/** Right after a password sign-in, offer this device's Face ID / fingerprint / Windows Hello. Once per person per device. */
export function PasskeyPrompt({ userId, list, add }: { userId: string | undefined; list: () => Promise<unknown[]>; add: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const toast = useToast();
  const me = userId ? { id: userId } : null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    let offer = false;
    try {
      offer = sessionStorage.getItem(OFFER_FLAG) === '1' && localStorage.getItem(dismissedKey(me.id)) !== '1';
      sessionStorage.removeItem(OFFER_FLAG);
    } catch {
      /* storage blocked: don't nag */
    }
    if (!offer) return;
    void (async () => {
      if (!(await deviceCanUsePasskeys())) return;
      const mine = await list().catch(() => [1]);
      if (!mine.length) setOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function notNow() {
    try {
      if (me) localStorage.setItem(dismissedKey(me.id), '1');
    } catch {
      /* fine */
    }
    setOpen(false);
  }

  async function setUp() {
    setBusy(true);
    try {
      await add();
      toast(t('passkeys.added'), 'ok');
      setOpen(false);
    } catch (e) {
      if (!cancelled(e)) toast(t('passkeys.failed'), 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={notNow}
      title={t('passkeys.offerTitle')}
      description={t('passkeys.offerHelp')}
      closeLabel={t('passkeys.notNow')}
      footer={
        <>
          <Button variant="ghost" onClick={notNow}>
            {t('passkeys.notNow')}
          </Button>
          <Button icon={<PasskeyIcon className="h-4 w-4" />} loading={busy} onClick={() => void setUp()}>
            {t('passkeys.setUp')}
          </Button>
        </>
      }
    />
  );
}
