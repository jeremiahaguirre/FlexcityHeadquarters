'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { SUPPORT_TOKEN_KEY, setAccessToken } from '@/lib/api';

/** Where an FH support link lands: trades its one-time code for a read-only visit, then opens the app. */
function Support() {
  const { t } = useTranslation();
  const router = useRouter();
  const code = useSearchParams().get('code');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!code) return setError(t('support.noCode'));
    const host = window.location.hostname;
    const sub = host.split('.')[0];
    void fetch('/api/auth/support', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(host.includes('.') && sub ? { 'x-tenant-subdomain': sub } : {}) }, body: JSON.stringify({ code }) })
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as { accessToken?: string; message?: string };
        if (!r.ok || !b.accessToken) return setError(b.message ?? t('support.failed'));
        try {
          sessionStorage.setItem(SUPPORT_TOKEN_KEY, b.accessToken);
        } catch {
          /* this tab only, then */
        }
        setAccessToken(b.accessToken);
        router.replace('/');
      })
      .catch(() => setError(t('support.failed')));
  }, [code, router, t]);
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="grid max-w-sm gap-4 text-center">
        <div className="mx-auto"><Logo size={40} /></div>
        <p className="flex items-center justify-center gap-2 text-body-strong"><ShieldCheck className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('support.title')}</p>
        <p className={error ? 'text-danger' : 'text-muted'}>{error ?? t('support.opening')}</p>
      </div>
    </main>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <Support />
    </Suspense>
  );
}
