'use client';

import { Building2, LogOut, Terminal } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { papi, usePlatformQuery } from '@/lib/platform';

/** The FH Dev console frame: FH branding only, no organization. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.endsWith('/platform/login') || pathname?.endsWith('/platform/login/')) return <>{children}</>;
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const me = usePlatformQuery<{ name: string; email: string }>('/me');
  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <Link href="/platform" className="flex min-w-0 items-center gap-3 rounded-xl" aria-label={t('platform.home')}>
            <Logo size={32} />
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-caption font-semibold text-page">
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              {t('platform.badge')}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/platform" className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-small font-semibold text-muted hover:bg-surface hover:text-ink sm:flex">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              {t('platform.cities')}
            </Link>
            <AuthLanguageSwitch />
            <button
              type="button"
              onClick={() => void papi('/auth/logout', { method: 'POST' }).finally(() => router.replace('/platform/login'))}
              className="flex h-10 items-center gap-2 rounded-full px-3 text-small font-semibold text-muted hover:bg-surface hover:text-ink"
              title={me.data ? `${me.data.name} · ${me.data.email}` : undefined}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('platform.signOut')}</span>
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16 pt-8 md:px-8">
        {me.data ? children : null}
      </main>
    </div>
  );
}
