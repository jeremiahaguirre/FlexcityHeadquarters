'use client';

import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface Skipped { userId: string; name: string; chargedHours: number; seniorityDate: string | null }

/** "This skips 2 people ahead in the overtime order" with who, why, and the agreement clause. */
export function OvertimeOrder({ skipped, clause }: { skipped: Skipped[]; clause: string | null }) {
  const { t } = useTranslation();
  if (!skipped.length) return null;
  return (
    <div className="mt-2 rounded-xl border border-warn/40 bg-panel px-3 py-2.5 text-small">
      <p className="flex items-center gap-2 font-semibold text-warn"><Scale className="h-4 w-4 shrink-0" aria-hidden="true" />{t('overtime.skips', { count: skipped.length })}{clause ? ` (${clause})` : ''}</p>
      <ul className="mt-1 grid gap-0.5 text-caption text-muted">
        {skipped.map((s) => (
          <li key={s.userId}>{t('overtime.skippedLine', { name: s.name, hours: s.chargedHours, since: s.seniorityDate ?? '—' })}</li>
        ))}
      </ul>
    </div>
  );
}
