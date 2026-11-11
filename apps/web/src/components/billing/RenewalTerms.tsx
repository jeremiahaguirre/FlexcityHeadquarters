'use client';

import { useTranslation } from 'react-i18next';
import { formatInstant } from '@/lib/format';
import { type TermView, renewalLines } from '@/lib/renewalTerms';

/**
 * The price and renewal terms in plain language, placed right beside the buttons that commit money
 * (pay, set up a bank debit, change plan). Buttons point at it with aria-describedby={id}.
 */
export function RenewalTerms({ term, contact, id, title }: { term: TermView | null; contact?: string | null; id?: string; title?: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (c: number) => new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD' }).format(c / 100);
  const date = (d: string) => formatInstant(d, lng);
  return (
    <div id={id} data-renewal-terms className="rounded-xl border border-line bg-surface px-3 py-2.5 text-caption text-muted">
      <p className="mb-1 font-semibold text-ink">{title ?? t('renewal.title')}</p>
      <ul className="grid list-disc gap-0.5 pl-4">
        {renewalLines(term, { t, money, date, contact }).map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}
