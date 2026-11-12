'use client';

import { KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { DEMO } from '@/lib/demo';
import { formatDate } from '@/lib/format';
import { cancelled, passkeysSupported } from '@/lib/passkeys';
import { PasskeyIcon } from './PasskeyIcon';

interface Passkey { id: string; name: string; createdAt: string; lastUsedAt: string | null }

/** Shared by the app profile and the Dev console account page. */
export function PasskeysCard({ list, add, remove }: { list: () => Promise<Passkey[]>; add: () => Promise<unknown>; remove: (id: string) => Promise<unknown> }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => list().then(setItems, () => setItems([]));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'ok');
      await reload();
    } catch (e) {
      if (cancelled(e)) return;
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('passkeys.failed'), 'warn');
    } finally {
      setBusy(null);
    }
  }
  const supported = passkeysSupported();
  const d = (iso: string) => formatDate(iso, i18n.language, 'dated');

  return (
    <Card>
      <CardHeader
        title={t('passkeys.title')}
        description={t('passkeys.help')}
        action={
          supported ? (
            <Button size="sm" variant="secondary" icon={<PasskeyIcon className="h-4 w-4" />} loading={busy === 'add'} onClick={() => void act('add', add, t('passkeys.added'))}>
              {t('passkeys.add')}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="pt-3">
        {!supported ? <p className="mb-3 text-small text-muted">{t(DEMO ? 'passkeys.demo' : 'passkeys.unsupported')}</p> : null}
        {!items?.length ? (
          <p className="text-small text-muted">{t('passkeys.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-center gap-3">
                  <KeyRound className="h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-small font-semibold">{p.name}</span>
                    <span className="text-caption text-muted">
                      {t('passkeys.addedOn', { date: d(p.createdAt) })}
                      {p.lastUsedAt ? ` · ${t('passkeys.lastUsed', { date: d(p.lastUsedAt) })}` : ''}
                    </span>
                  </span>
                </span>
                <Button size="sm" variant="ghost" aria-label={t('passkeys.removeNamed', { name: p.name })} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} loading={busy === p.id} onClick={() => void act(p.id, () => remove(p.id), t('passkeys.removed'))}>
                  {t('passkeys.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
