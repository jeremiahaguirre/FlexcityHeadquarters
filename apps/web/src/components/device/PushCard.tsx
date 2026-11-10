'use client';

import { Bell, BellOff, BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { type PushState, disablePush, enablePush, pushState } from '@/lib/device';
import { InstallApp } from './InstallApp';

/** Notifications on this phone or computer: on, off, and why not when the browser can't. */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState).catch(() => setState('unsupported'));
  }, []);
  if (!state || (compact && (state === 'on' || state === 'unsupported' || state === 'unavailable'))) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush());
    } catch {
      setState(await pushState().catch(() => 'unsupported' as const));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('push.title')}
        description={t('push.description')}
        action={state === 'on' ? <StatusPill tone="ok">{t('push.onPill')}</StatusPill> : null}
      />
      <CardBody className="grid gap-3 pt-2">
        {state === 'needs-install' ? (
          <>
            <p className="text-small text-muted">{t('push.needsInstall')}</p>
            <InstallApp />
          </>
        ) : state === 'blocked' ? (
          <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{t('push.blocked')}</p>
        ) : state === 'unsupported' ? (
          <p className="text-small text-muted">{t('push.unsupported')}</p>
        ) : state === 'unavailable' ? (
          <p className="text-small text-muted">{t('push.unavailable')}</p>
        ) : (
          <>
            <Button variant={state === 'on' ? 'secondary' : 'primary'} loading={busy} className="justify-self-start" icon={state === 'on' ? <BellOff className="h-4 w-4" aria-hidden="true" /> : <BellRing className="h-4 w-4" aria-hidden="true" />} onClick={() => void toggle()}>
              {state === 'on' ? t('push.turnOff') : t('push.turnOn')}
            </Button>
            <p className="flex items-start gap-2 text-caption text-muted"><Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('push.privacy')}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
