'use client';

import { CalendarX2, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { DataExportCard, type ExportSummary } from '@/components/settings/DataExportCard';
import { Button } from '@/components/ui/Button';
import { api, logout } from '@/lib/api';

/**
 * The data export on its own page: where a closed organization's administrators land after
 * signing in (nothing else opens for them), and a direct link for anyone who can export.
 */
export default function ExportPage() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<'loading' | 'signedOut' | 'forbidden' | ExportSummary>('loading');
  useEffect(() => {
    api<ExportSummary>('/api/data-export').then(setState, (e: { status?: number }) => setState(e.status === 401 ? 'signedOut' : 'forbidden'));
  }, []);
  const until = typeof state === 'object' && state.exportUntil ? new Date(state.exportUntil).toLocaleDateString(i18n.language, { dateStyle: 'long' }) : null;
  return (
    <main className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto grid max-w-2xl gap-6">
        <div className="flex items-center justify-between gap-3">
          <Logo size={36} />
          {typeof state === 'object' ? (
            <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" aria-hidden="true" />} onClick={() => void logout().then(() => window.location.assign('/login'))}>{t('shell.signOut')}</Button>
          ) : null}
        </div>
        {typeof state === 'object' && state.closed ? (
          <div className="flex items-start gap-3 rounded-2xl border border-line bg-panel p-4">
            <CalendarX2 className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
            <div>
              <h1 className="text-heading">{t('dataExport.closedTitle')}</h1>
              <p className="mt-1 text-small text-muted">{until ? t('dataExport.closedHelp', { date: until }) : t('dataExport.closedNoDate')}</p>
            </div>
          </div>
        ) : (
          <h1 className="text-title">{t('dataExport.title')}</h1>
        )}
        {state === 'loading' ? null : state === 'signedOut' ? (
          <p className="text-body">{t('dataExport.signIn')} <Link href="/login?next=/export" className="font-semibold text-brand-text hover:underline">{t('login.submit')}</Link></p>
        ) : state === 'forbidden' ? (
          <p className="text-body text-muted">{t('dataExport.forbidden')}</p>
        ) : (
          <DataExportCard />
        )}
      </div>
    </main>
  );
}
