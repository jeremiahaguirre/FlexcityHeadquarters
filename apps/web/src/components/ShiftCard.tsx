'use client';

import { Clock, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatHours, formatTimeRange, dateFormat } from '@/lib/format';

export interface ShiftLike {
  localStartsAt: string;
  localEndsAt: string;
  facility: { name: string };
  position: { name: string; nameFr: string | null };
  customTitle?: string | null;
}

/** Date block + position, time and place. Used on Today, Schedule and the Board. */
export function ShiftCard({ shift, aside, footer, highlight }: { shift: ShiftLike; aside?: ReactNode; footer?: ReactNode; highlight?: boolean }) {
  const { i18n } = useTranslation();
  const lng = i18n.language;
  const wall = new Date(`${shift.localStartsAt.slice(0, 10)}T12:00:00Z`);
  const weekday = dateFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(wall);
  const dayNum = dateFormat(lng, { day: 'numeric', timeZone: 'UTC' }).format(wall);
  const month = dateFormat(lng, { month: 'short', timeZone: 'UTC' }).format(wall);
  const hours = (Date.parse(shift.localEndsAt) - Date.parse(shift.localStartsAt)) / 3_600_000;
  const position = lng === 'fr-CA' && shift.position.nameFr ? shift.position.nameFr : shift.position.name;
  return (
    <div className={cn('rounded-xl2 border bg-panel p-4 shadow-card', highlight ? 'border-brand/40 ring-1 ring-brand/20' : 'border-line')}>
      <div className="flex gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-brand/10 py-2 text-brand-text">
          <span className="text-label">{weekday}</span>
          <span className="text-heading leading-none">{dayNum}</span>
          <span className="text-caption">{month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-subheading text-ink">{shift.customTitle || position}</p>
            {aside}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-small text-muted">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{formatTimeRange(shift.localStartsAt, shift.localEndsAt, lng)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatHours(hours, lng)}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-small text-muted">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{shift.facility.name}</span>
          </p>
        </div>
      </div>
      {footer ? <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">{footer}</div> : null}
    </div>
  );
}
