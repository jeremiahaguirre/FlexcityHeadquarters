'use client';

import { Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

interface Preview { available: boolean; gross?: string; overtimeHours?: string; statHoliday?: boolean; premiumPerHour?: string | null }

/** "About $142.50 (incl. 2 h overtime)" on an open shift, before claiming. */
export function PayPreview({ offerId }: { offerId: string }) {
  const { t, i18n } = useTranslation();
  const p = useQuery<Preview>(`/api/offers/${offerId}/pay-preview`);
  if (!p.data?.available || !p.data.gross) return null;
  const extras = [
    Number(p.data.overtimeHours) > 0 ? t('board.payOvertime', { h: Number(p.data.overtimeHours) }) : null,
    p.data.statHoliday ? t('board.payStat') : null,
    p.data.premiumPerHour ? t('board.payPremium') : null,
  ].filter(Boolean);
  return (
    <p className="flex items-center gap-1.5 text-small font-semibold text-ok" title={t('board.payHint')}>
      <Wallet className="h-4 w-4" aria-hidden="true" />
      {t('board.payAbout', { amount: formatMoney(p.data.gross, i18n.language as 'en-CA' | 'fr-CA') })}
      {extras.length ? <span className="font-normal text-muted">({extras.join(', ')})</span> : null}
    </p>
  );
}
