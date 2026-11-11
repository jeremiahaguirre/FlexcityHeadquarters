'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { dateFormat } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

interface Holiday {
  province: string;
  key: string | null;
  name: string;
  nameFr: string | null;
  date: string;
  kind: 'ACTUAL' | 'MOVED' | 'MOVED_IF_OFF';
  observedOn: string | null;
  closedOn: string;
}

/**
 * The coming year's statutory holidays, each with its own date and, when it differs, the day
 * people are off for it: the day the law moves it to, or the weekday the organization observes.
 */
export function UpcomingHolidays({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<{ provinces: string[]; holidays: Holiday[] }>('/api/me/holidays');
  const [all, setAll] = useState(false);
  if (q.error || !q.data?.holidays.length) return null;
  const fmt = (d: string) => dateFormat(lng, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const several = q.data.provinces.length > 1;
  const list = all ? q.data.holidays : q.data.holidays.slice(0, 5);
  return (
    <Card className={className}>
      <CardHeader title={t('timeOff.holidaysTitle')} description={t('timeOff.holidaysHelp')} />
      <CardBody className="pt-2">
        <ul className="divide-y divide-line">
          {list.map((h) => {
            const name = lng.startsWith('fr') && h.nameFr ? h.nameFr : h.name;
            // MOVED_IF_OFF (the Fête nationale on a Sunday): June 25 for people who don't work Sundays.
            const note = h.kind === 'MOVED_IF_OFF' && h.observedOn ? t('timeOff.holidayMovedIfOff', { date: fmt(h.observedOn) }) : h.closedOn !== h.date ? t('timeOff.holidayObserved', { date: fmt(h.closedOn) }) : null;
            return (
              <li key={`${h.province}-${h.date}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5 text-small">
                <span className="min-w-0 font-semibold text-ink">
                  {name}
                  {several ? <span className="ml-1.5 font-normal text-muted">{h.province}</span> : null}
                </span>
                <span className="text-muted tabular-nums">
                  {fmt(h.date)}
                  {note ? <span className="block text-right text-ink">{note}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        {q.data.holidays.length > 5 ? (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(!all)}>
            {all ? t('timeOff.holidaysLess') : t('timeOff.holidaysMore', { count: q.data.holidays.length })}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
