'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CityBrand, CoBrand, type Organization } from '@/components/CoBrand';
import { Logo } from '@/components/Logo';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { type NavItem, phoneTabs, visibleNav } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { PasskeyPrompt } from '@/components/auth/PasskeyPrompt';
import { MfaDialog } from '@/components/auth/MfaDialog';
import { StepUpDialog } from '@/components/auth/StepUpDialog';
import { api } from '@/lib/api';
import { addPasskey } from '@/lib/passkeys';
import { PunchControl } from '@/components/punch/PunchControl';
import { PunchProvider } from '@/components/punch/PunchProvider';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

const GROUPS: Array<NavItem['group']> = ['mine', 'deck', 'manage', 'union'];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, organization }: { children: ReactNode; organization: Organization }) {
  const { t } = useTranslation();
  const { can, me } = useSession();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = visibleNav(can, me?.hiddenMenu ?? []);
  const { tabs, more } = phoneTabs(items);

  const link = (n: NavItem, onClick?: () => void) => {
    const active = isActive(pathname, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-small font-semibold transition-colors',
          active ? 'bg-brand/10 text-brand-text' : 'text-muted hover:bg-surface hover:text-ink',
        )}
      >
        <n.icon className="h-5 w-5 shrink-0" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
        {t(`nav.${n.key}`)}
      </Link>
    );
  };

  return (
    <PunchProvider>
    <div className="min-h-screen md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-panel md:flex">
        <div className="px-5 pb-4 pt-6">
          <Link href="/" className="inline-block rounded-xl" aria-label="FlexcityHeadquarters">
            <Logo size={40} />
          </Link>
          {/* The organization sits under the FH logo, never in its place. */}
          <div className="mt-4 flex min-h-[2.5rem] items-center border-t border-line pt-4">
            <CityBrand org={organization} showName={!!organization.logoUrl} />
          </div>
        </div>
        <nav aria-label={t('shell.mainNav')} className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
          {GROUPS.map((g) => {
            const list = items.filter((n) => n.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <p className="mb-1.5 px-3 text-label uppercase text-muted/80">{t(`navGroups.${g}`)}</p>
                <div className="grid gap-0.5">{list.map((n) => link(n))}</div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <UserMenu placement="up" />
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur supports-[backdrop-filter]:bg-page/70">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
            <Link href="/" className="min-w-0 rounded-xl md:hidden" aria-label={`FlexcityHeadquarters · ${organization.name}`}>
              <CoBrand org={organization} logoSize={30} citySize="sm" />
            </Link>
            <span className="hidden md:block" />
            <div className="flex items-center gap-1.5">
              <PunchControl />
              <NotificationBell />
              <div className="md:hidden">
                <UserMenu compact />
              </div>
            </div>
          </div>
        </header>

        <main id="main" key={pathname} className="animate-page-in mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-12 md:pt-8">
          {children}
        </main>
      </div>

      <StepUpDialog />
      <MfaDialog />
      <PasskeyPrompt userId={me?.id} skip={me?.mfaRequired} list={() => api<unknown[]>('/api/me/passkeys')} add={addPasskey} />

      {/* Phone tab bar */}
      <nav
        aria-label={t('shell.mainNav')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${tabs.length + (more.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {tabs.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn('flex h-16 flex-col items-center justify-center gap-1 text-caption font-semibold', active ? 'text-brand-text' : 'text-muted')}
                >
                  <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-colors', active && 'bg-brand/10')}>
                    <n.icon className="h-5 w-5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                  </span>
                  <span className="max-w-full truncate px-1">{t(`nav.${n.key}Short`, { defaultValue: t(`nav.${n.key}`) })}</span>
                </Link>
              </li>
            );
          })}
          {more.length ? (
            <li>
              <button type="button" onClick={() => setMoreOpen(true)} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-caption font-semibold text-muted">
                <span className="grid h-7 w-12 place-items-center rounded-full">
                  <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                </span>
                {t('nav.more')}
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')} closeLabel={t('common.close')}>
        <div className="grid gap-0.5 pb-2">{more.map((n) => link(n, () => setMoreOpen(false)))}</div>
      </Dialog>
    </div>
    </PunchProvider>
  );
}
