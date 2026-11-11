'use client';

import { BookOpen, Building2, Inbox, KeyRound, Landmark, LogOut, Receipt, Scale, Terminal } from 'lucide-react';
import { CommandMenu, type Destination } from '@/components/shell/CommandMenu';
import { SchemePicker } from '@/components/shell/SchemePicker';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveLogo } from '@/components/LiveLogo';
import { LogoMark } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { PasskeyPrompt } from '@/components/auth/PasskeyPrompt';
import { platformAddPasskey } from '@/lib/passkeys';
import { papi, usePlatformQuery } from '@/lib/platform';

/** The FH Dev console frame: FH branding only, no organization. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.endsWith('/platform/login') || pathname?.endsWith('/platform/login/')) return <>{children}</>;
  return <SignedIn>{children}</SignedIn>;
}

const NAV = [
  { href: '/platform', key: 'platform.cities', icon: Building2, exact: true },
  { href: '/platform/billing', key: 'billing.title', icon: Receipt },
  { href: '/platform/debits', key: 'debits.nav', icon: Landmark },
  { href: '/platform/books', key: 'books.nav', icon: BookOpen },
  { href: '/platform/enquiries', key: 'enquiries.nav', icon: Inbox },
  { href: '/platform/payroll-tax', key: 'payTax.nav', icon: Scale },
] as const;

function SignedIn({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const me = usePlatformQuery<{ id: string; name: string; email: string }>('/me');
  const path = pathname.replace(/\/$/, '').replace(/^.*?(\/platform)/, '$1');
  const active = (n: (typeof NAV)[number]) => ('exact' in n && n.exact ? path === n.href || path.startsWith('/platform/city') : path === n.href || path.startsWith(`${n.href}/`));
  const signOut = () => void papi('/auth/logout', { method: 'POST' }).finally(() => router.replace('/platform/login'));
  const destinations: Destination[] = [...NAV.map((n) => ({ href: n.href, label: t(n.key), group: t('platform.badge'), icon: n.icon })), { href: '/platform/account', label: t('platform.account'), group: t('platform.badge'), icon: KeyRound }];
  return (
    <div className="min-h-screen bg-page md:grid md:grid-cols-[16.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-panel md:flex print:hidden">
        <div className="px-5 pb-4 pt-6">
          <Link href="/platform" className="inline-block rounded-xl" aria-label={t('platform.home')}><LiveLogo size={32} /></Link>
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-caption font-semibold text-page">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            {t('platform.badge')}
          </span>
        </div>
        <nav aria-label={t('platform.badge')} className="flex-1 px-3">
          <div className="grid gap-0.5">
            {NAV.map((n) => {
              const on = active(n);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-small font-semibold transition-colors ${on ? 'bg-brand/10 text-brand-text' : 'text-muted hover:bg-surface hover:text-ink'}`}>
                  <n.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {t(n.key)}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="grid gap-1 border-t border-line p-3">
          <Link href="/platform/account" className="flex items-center gap-3 rounded-xl px-3 py-2 text-small font-semibold text-muted hover:bg-surface hover:text-ink">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{me.data?.name ?? t('platform.account')}</span>
          </Link>
          <button type="button" onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2 text-small font-semibold text-muted hover:bg-surface hover:text-ink">
            <LogOut className="h-5 w-5" aria-hidden="true" />
            {t('platform.signOut')}
          </button>
          <SchemePicker className="mt-1" />
          <div className="px-1 pt-1"><AuthLanguageSwitch /></div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur print:hidden">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
            <Link href="/platform" className="flex items-center gap-2 rounded-xl md:hidden" aria-label={t('platform.home')}>
              <LogoMark size={30} />
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-caption font-semibold text-page"><Terminal className="h-3 w-3" aria-hidden="true" />{t('platform.badge')}</span>
            </Link>
            <div className="hidden flex-1 md:block"><CommandMenu destinations={destinations} /></div>
            <div className="flex items-center gap-1 md:hidden">
              <CommandMenu destinations={destinations} compact />
              <Link href="/platform/account" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface" aria-label={t('platform.account')}><KeyRound className="h-5 w-5" aria-hidden="true" /></Link>
              <button type="button" onClick={signOut} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface" aria-label={t('platform.signOut')}><LogOut className="h-5 w-5" aria-hidden="true" /></button>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-16 md:pt-8 print:max-w-none print:p-0">
          {me.data ? children : null}
        </main>
      </div>

      {/* Phone: every console page one tap away. */}
      <nav aria-label={t('platform.badge')} className="fh-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        <ul className="grid grid-cols-6">
          {NAV.map((n) => {
            const on = active(n);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center gap-1 px-1 py-2 text-[0.6875rem] font-semibold ${on ? 'text-brand-text' : 'text-muted'}`}>
                  <span className={`grid h-7 w-12 place-items-center rounded-full ${on ? 'bg-brand/10' : ''}`}><n.icon className="h-5 w-5" aria-hidden="true" /></span>
                  <span className="max-w-full truncate">{t(`${n.key}Short`, { defaultValue: t(n.key) })}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <PasskeyPrompt userId={me.data?.id} list={() => papi<unknown[]>('/passkeys')} add={platformAddPasskey} />
    </div>
  );
}
