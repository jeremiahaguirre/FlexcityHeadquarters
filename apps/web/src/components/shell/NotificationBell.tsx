'use client';

import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { type AppNotification, useNotifications } from '@/lib/notifications';

function timeAgo(iso: string, locale: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (s < 60) return rtf.format(0, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86_400), 'day');
}

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { items, unread, markAllRead } = useNotifications();
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

  const go = (n: AppNotification) => {
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread ? t('shell.notificationsUnread', { count: unread }) : t('shell.notifications')}
        className="relative grid h-11 w-11 place-items-center rounded-full text-ink hover:bg-surface"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread ? (
          <span key={unread} className="fh-badge absolute right-1.5 top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-new px-1 text-[0.6875rem] font-bold leading-[1.125rem] text-white dark:text-page">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="fixed inset-x-3 top-16 z-40 overflow-hidden rounded-2xl border border-line bg-panel shadow-lift md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-96">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-subheading">{t('shell.notifications')}</h2>
            {unread ? (
              <button type="button" onClick={() => void markAllRead()} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-small font-semibold text-brand-text hover:bg-surface">
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                {t('shell.markAllRead')}
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-small text-muted">
              <BellOff className="h-6 w-6" aria-hidden="true" />
              {t('shell.noNotifications')}
            </div>
          ) : (
            <ul className="fh-stagger max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => go(n)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface', !n.readAt && 'bg-new-bg/40')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-new')} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-small text-ink">{t(`notifications.${n.type}`, { ...n.params, defaultValue: t('notifications.generic') })}</span>
                      <span className="mt-0.5 block text-caption text-muted">{timeAgo(n.createdAt, i18n.language)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
