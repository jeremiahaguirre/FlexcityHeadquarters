'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/apiError';
import { pdownload, usePlatformQuery } from '@/lib/platform';

/** What the signed-in admin may do in Trust. */
export function useTrustAccess() {
  const me = usePlatformQuery<{ id: string; name: string; permissions?: string[] }>('/me');
  const perms = me.data?.permissions ?? [];
  return { me: me.data, canManage: perms.includes('trust.manage'), canRead: perms.includes('trust.read') || perms.includes('trust.manage') };
}

export function usePeople() {
  return usePlatformQuery<Array<{ id: string; name: string }>>('/trust/people').data ?? [];
}

/** Downloads that need a passkey step-up: confirm, then try once more. */
export async function trustDownload(path: string, name: string) {
  try {
    await pdownload(path, name);
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'PASSKEY_STEP_UP') throw e;
    const { platformConfirmWithPasskey } = await import('@/lib/passkeys');
    await platformConfirmWithPasskey();
    await pdownload(path, name);
  }
}

/** "Updated just now", "Updated 2 min ago": re-renders every 15 s. */
export function useAgo(ts: number | string | null | undefined) {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!ts) return t('trust.never');
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  return s < 45 ? t('trust.justNow') : s < 3600 ? t('trust.minAgo', { count: Math.round(s / 60) }) : s < 86_400 ? t('trust.hoursAgo', { count: Math.round(s / 3600) }) : t('trust.daysAgo', { count: Math.round(s / 86_400) });
}

/** A query-string value (?id=…), read after mount so pages don't need a Suspense boundary. */
export function useParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  return v;
}
