'use client';

import { Lock, MoreHorizontal, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CityBrand, CoBrand, type Organization } from '@/components/CoBrand';
import { LiveLogo } from '@/components/LiveLogo';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { MANAGE_SECTIONS, NAV, type NavItem, phoneTabs, visibleNav } from '@/lib/nav';
import { BillingBanner } from '@/components/shell/BillingBanner';
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
import { CommandMenu, type Destination } from './CommandMenu';
import { SideNav } from './SideNav';
import { NoAccess } from './NoAccess';
import { ConsentGate } from '@/components/privacy/ConsentGate';
import { Copyright } from '@/components/Copyright';


function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, organization }: { children: ReactNode; organization: Organization }) {
  const { t } = useTranslation();
  const { can, me } = useSession();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // Offboarded: the one thing left is the data export.
  useEffect(() => {
    if (me?.closed) window.location.replace('/export');
  }, [me?.closed]);
  const items = visibleNav(can, me?.hiddenMenu ?? []);
  // A menu screen opened by its address without access: say so, instead of an empty or broken page.
  const path = pathname.replace(/\/$/, '') || '/';
  const noAccess = !!me && NAV.some((n) => n.href === path) && !items.some((n) => n.href === path) && !(me.lockedMenu ?? []).some((l) => l.href === path);
  const { tabs, more } = phoneTabs(items);
  const destinations: Destination[] = [
    ...items.map((n) => ({ href: n.href, label: t(`nav.${n.key}`), group: n.section ? t(`navSections.${n.section}`) : t(`navGroups.${n.group}`), icon: n.icon })),
    { href: '/profile', label: t('jump.profile'), group: t('navGroups.mine'), icon: UserRound },
  ];

  const link = (n: NavItem, onClick?: () => void) => {
    const active = isActive(pathname, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-small font-semibold transition-colors',
          active ? 'bg-brand/10 text-brand-text' : 'text-muted hover:bg-surface hover:text-ink',
        )}
      >
        <n.icon className="h-5 w-5 shrink-0" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
        {t(`nav.${n.key}`)}
      </Link>
    );
  };

  const lockedLink = (l: { href: string; key: string; addOn: string }) => {
    const Icon = NAV.find((n) => n.href === l.href)?.icon ?? Lock;
    return (
      <Link
        key={l.href}
        href={`/manage/billing?unlock=${l.addOn}`}
        title={t('billingPage.lockedHint', { addOn: t(`plans.item.${l.addOn}`) })}
        className="flex items-center gap-3 rounded-xl px-3 py-2 text-small font-semibold text-muted/60 hover:bg-surface"
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t(`nav.${l.key}`)}</span>
        <Lock className="h-3.5 w-3.5" aria-label={t('billingPage.locked')} />
      </Link>
    );
  };

  // The first-sign-in agreement comes before anything else (never for an FH support visit).
  if (me?.consentRequired && !me.support)
    return (
      <>
        <ConsentGate />
        <StepUpDialog />
        <MfaDialog />
      </>
    );

  return (
    <PunchProvider>
    <div className="min-h-screen md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-panel md:flex">
        <div className="px-5 pb-4 pt-6">
          <Link href="/" className="inline-block rounded-xl" aria-label="FlexcityHeadquarters">
            <LiveLogo size={40} />
          </Link>
          {/* The organization sits under the FH logo, never in its place. */}
          <div className="mt-4 flex min-h-[2.5rem] items-center border-t border-line pt-4">
            <CityBrand org={organization} showName={!!organization.logoUrl} />
          </div>
        </div>
        <nav aria-label={t('shell.mainNav')} className="fh-scroll-fade flex-1 overflow-y-auto px-3 pb-8">
          <SideNav items={items} locked={me?.lockedMenu ?? []} activeHref={items.find((n) => isActive(pathname, n.href))?.href ?? null} link={(n) => link(n)} lockedLink={lockedLink} />
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
            <div className="hidden flex-1 md:block"><CommandMenu destinations={destinations} /></div>
            <div className="flex items-center gap-1.5">
              <div className="md:hidden"><CommandMenu destinations={destinations} compact /></div>
              <PunchControl />
              <NotificationBell />
              <div className="md:hidden">
                <UserMenu compact />
              </div>
            </div>
          </div>
        </header>

        <main id="main" key={pathname} className="fh-page mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-12 md:pt-8">
          {me?.support ? (
            <div role="status" className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-new/30 bg-new-bg px-4 py-3 text-small text-ink">
              <ShieldCheck className="h-4 w-4 shrink-0 text-new" aria-hidden="true" />
              <span className="font-semibold">{t('support.banner', { name: me.support.admin })}</span>
              <span className="text-muted">{t(`support.level.${me.support.level}`)} · {t('support.until', { time: new Date(me.support.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) })}</span>
            </div>
          ) : null}
          <BillingBanner />
          {noAccess ? <NoAccess /> : children}
        </main>
      </div>

      <StepUpDialog />
      <MfaDialog />
      <PasskeyPrompt userId={me?.id} skip={me?.mfaRequired} list={() => api<unknown[]>('/api/me/passkeys')} add={addPasskey} />

      {/* Phone tab bar */}
      <nav
        aria-label={t('shell.mainNav')}
        className="fh-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
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
                  <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-[background-color,transform] duration-200 ease-out', active ? 'scale-100 bg-brand/10' : 'scale-90')}>
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
        <div className="grid gap-4 pb-2">
          {[null, ...MANAGE_SECTIONS].map((sec) => {
            const list = more.filter((n) => (sec === null ? n.group !== 'manage' : n.group === 'manage' && (n.section ?? 'organization') === sec));
            if (!list.length) return null;
            return (
              <div key={sec ?? 'mine'}>
                <p className="mb-1 px-3 text-label uppercase text-muted">{sec ? t(`navSections.${sec}`) : t('navGroups.mine')}</p>
                <div className="grid gap-0.5">{list.map((n) => link(n, () => setMoreOpen(false)))}</div>
              </div>
            );
          })}
          <Copyright className="px-3 text-center" />
        </div>
      </Dialog>
    </div>
    </PunchProvider>
  );
}
