'use client';

import { ChevronDown, Languages, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { SchemePicker } from './SchemePicker';
import { LOCALE_COOKIE } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { roleName } from '@/lib/customRoles';

export function useLanguageSwitch() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const next = i18n.language === 'fr-CA' ? 'en-CA' : 'fr-CA';
  return {
    next,
    switchLanguage: () => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      void i18n.changeLanguage(next);
      router.refresh();
    },
  };
}

/** Avatar button with profile, language and sign-out. `compact` shows only the avatar. */
export function UserMenu({ compact = false, placement = 'down' }: { compact?: boolean; placement?: 'down' | 'up' }) {
  const { t, i18n } = useTranslation();
  const { me, signOut } = useSession();
  const { switchLanguage } = useLanguageSwitch();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!me) return null;
  const name = `${me.firstName} ${me.lastName}`;
  const item = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-small font-medium text-ink hover:bg-surface';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t('shell.accountMenu', { name })}
        className={cn('flex items-center gap-3 rounded-2xl text-left hover:bg-surface', compact ? 'p-0.5' : 'w-full p-2')}
      >
        <Avatar name={name} size={compact ? 'sm' : 'md'} />
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-small font-semibold text-ink">{name}</span>
              <span className="block truncate text-caption text-muted">{me.customRoles?.[0] ? roleName(me.customRoles[0], i18n.language) : t(`roles.${me.roles[0]}`)}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
          </>
        )}
      </button>
      {open ? (
        <div
          className={cn(
            'absolute z-40 w-72 rounded-2xl border border-line bg-panel p-1.5 shadow-lift',
            placement === 'up' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2',
          )}
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-small font-semibold">{name}</p>
            <p className="truncate text-caption text-muted">{me.email}</p>
          </div>
          <Link href="/profile" className={item} onClick={() => setOpen(false)}>
            <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
            {t('shell.profile')}
          </Link>
          <button type="button" className={item} onClick={switchLanguage} lang={t('app.languageCode')}>
            <Languages className="h-4 w-4 text-muted" aria-hidden="true" />
            {t('app.language')}
          </button>
          <div className="px-1.5 py-1.5"><SchemePicker /></div>
          <button type="button" className={item} onClick={() => void signOut()}>
            <LogOut className="h-4 w-4 text-muted" aria-hidden="true" />
            {t('shell.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
