'use client';

import { AlertTriangle, Lock } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/lib/session';

/**
 * Overdue: a warning for whoever handles billing, with the date the app turns
 * read-only. Suspended: everyone sees why changes are refused.
 */
export function BillingBanner() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const b = me?.billing;
  if (!b || (b.stage !== 'overdue' && b.stage !== 'suspended')) return null;
  if (b.stage === 'overdue' && !b.canPay) return null;
  const date = (d: string | null) => (d ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) : '');
  const suspended = b.stage === 'suspended';
  return (
    <div role={suspended ? 'alert' : 'status'} className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-small ${suspended ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn'}`}>
      {suspended ? <Lock className="h-5 w-5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />}
      <p className="min-w-0 flex-1 font-semibold">
        {suspended ? t(b.canPay ? 'billingPage.suspendedPay' : 'billingPage.suspendedStaff') : t('billingPage.overdue', { since: date(b.overdueSince), date: date(b.suspendsOn) })}
      </p>
      {b.canPay ? (
        <Link href="/manage/billing" className="rounded-xl bg-panel px-3 py-1.5 font-semibold text-ink shadow-card hover:bg-surface">
          {t('billingPage.payNow')}
        </Link>
      ) : null}
    </div>
  );
}
