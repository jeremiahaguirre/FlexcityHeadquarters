'use client';

import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { pick } from '@/lib/noteText';
import { useLiveChange } from '@/lib/useLiveChange';
import { useQuery } from '@/lib/useQuery';
import { windowLabel } from './MaintenanceBanner';

interface Upcoming { id: string; startsAt: string; endsAt: string; message: { en: string; fr: string }; status: 'upcoming' | 'active' }

/** Maintenance planned in the next two weeks (What's new page). */
export function PlannedMaintenance() {
  const { t, i18n } = useTranslation();
  const q = useQuery<{ upcoming: Upcoming[] }>('/api/maintenance');
  useLiveChange('updates', q.reload);
  if (!q.data?.upcoming.length) return null;
  return (
    <Card className="mb-6">
      <CardHeader title={t('maintenance.plannedTitle')} description={t('maintenance.plannedHelp')} />
      <CardBody className="grid gap-3 pt-2">
        {q.data.upcoming.map((w) => (
          <div key={w.id} className="flex items-start gap-3">
            <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-small font-semibold">
                {windowLabel(w, i18n.language)}
                {w.status === 'active' ? <StatusPill tone="warn">{t('maintenance.happeningNow')}</StatusPill> : null}
              </p>
              <p className="text-small text-muted">{pick(i18n.language, w.message)}</p>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
