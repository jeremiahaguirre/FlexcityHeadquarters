'use client';

import { Armchair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/lib/session';
import { useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

/** "You're on the deep-end chair until 2:30" for the guard on deck. */
export function MyStation() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  // Only people who work the deck; a switched-off feature just answers 404 and shows nothing.
  const mine = useQuery<{ station: string | null; facility: string; startedAt: string; dueAt: string | null } | null>(can('ops.headcount.record') ? '/api/me/deck' : null);
  const d = mine.data;
  if (!d) return null;
  const time = (iso: string) => dateFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3">
      <Armchair className="h-6 w-6 shrink-0 text-brand-text" aria-hidden="true" />
      <p className="text-small">
        {d.station && d.dueAt ? t('deck.yourStation', { station: d.station, time: time(d.dueAt) }).replace(/\.\.$/, '.') : t('deck.onBreak')}
      </p>
    </div>
  );
}
