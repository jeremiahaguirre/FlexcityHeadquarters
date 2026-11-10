'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { ssoExchange } from '@/lib/api';

/** Back from Microsoft / the identity provider: trade the one-time code for a session. */
function Sso() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get('code');
    const next = params.get('next');
    if (!code) return setFailed(true);
    ssoExchange(code)
      .then(() => router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/'))
      .catch(() => setFailed(true));
  }, [params, router]);
  return (
    <div className="grid gap-4" aria-live="polite">
      <h1 className="text-title">{t('login.ssoTitle')}</h1>
      {failed ? (
        <>
          <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{t('login.ssoErrors.LINK_EXPIRED')}</p>
          <Link href="/login" className="font-semibold text-brand-text hover:underline">{t('login.backToSignIn')}</Link>
        </>
      ) : (
        <p className="text-muted">{t('login.ssoFinishing')}</p>
      )}
    </div>
  );
}

export default function SsoPage() {
  return (
    <Suspense>
      <Sso />
    </Suspense>
  );
}
