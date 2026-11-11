'use client';

import { LogIn, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate, formatHours, formatTime, formatTimeRange, dateFormat } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { PunchControl } from '@/components/punch/PunchControl';
import { usePunch } from '@/components/punch/PunchProvider';
import { SavedPunches } from '@/components/punch/SavedPunches';

interface Punch { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; localClockIn: string; localClockOut: string | null; hours: number | null; varianceReason: string | null; locationStatus: string; facility: { name: string } }

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function TimeclockPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const now = useNow();
  const punch = usePunch();
  const [start] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const recent = useQuery<Punch[]>(`/api/me/punches?from=${encodeURIComponent(new Date(start.getTime() - 14 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + 86_400_000).toISOString())}`);
  const version = punch?.version ?? 0;
  useEffect(() => {
    if (version) void recent.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const statusTone = { PENDING: 'neutral', APPROVED: 'ok', REJECTED: 'warn' } as const;
  // Other shifts today, if the person wants a specific one rather than the suggested one.
  const others = (punch?.shifts ?? []).filter((s) => s.id !== punch?.suggested?.id && Date.parse(s.endsAt) > now.getTime() && s.localStartsAt.slice(0, 10) === punch?.shifts[0]?.localStartsAt.slice(0, 10));

  return (
    <>
      <PageHeader title={t('timeclock.title')} description={t('timeclock.description')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="text-center">
            <p className="text-stat tabular-nums" aria-live="off">
              {dateFormat(lng, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(now)}
            </p>
            <p className="mt-1 text-small text-muted">{dateFormat(lng, { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</p>
          </div>
          {!punch || punch.loading ? <Skeleton className="h-24 w-full" /> : <PunchControl variant="large" />}
          <SavedPunches />
          {punch && !punch.open ? (
            <div className="grid gap-2">
              {others.map((s) => (
                <Button key={s.id} variant="secondary" block icon={<LogIn className="h-4 w-4" aria-hidden="true" />} loading={punch.busy === 'in'} onClick={() => void punch.clockInFor({ facilityId: s.facilityId, shiftId: s.id })}>
                  {t('timeclock.clockInFor', { time: formatTimeRange(s.localStartsAt, s.localEndsAt, lng), place: s.facility.name })}
                </Button>
              ))}
              <Button variant="ghost" block onClick={punch.askUnscheduled}>
                {t('timeclock.unscheduled')}
              </Button>
            </div>
          ) : null}
          <p className="flex items-start gap-2 text-left text-caption text-muted">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('timeclock.locationNote')}
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-subheading">{t('timeclock.recent')}</h2>
          {recent.loading ? (
            <Skeleton className="mt-4 h-40" />
          ) : !recent.data && recent.error ? (
            <p className="mt-4 text-small text-muted">{t('timeclock.offline.recentLater')}</p>
          ) : !recent.data?.length ? (
            <p className="mt-4 text-small text-muted">{t('timeclock.noPunches')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {recent.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-small font-semibold">{formatDate(p.localClockIn, lng)}</p>
                    <p className="text-caption tabular-nums text-muted">
                      {p.localClockOut ? formatTimeRange(p.localClockIn, p.localClockOut, lng) : `${formatTime(p.localClockIn, lng)} – …`} · {p.facility.name}
                    </p>
                    {p.status === 'REJECTED' && p.varianceReason ? <p className="mt-1 text-caption text-warn">{p.varianceReason}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.hours != null ? <span className="text-small tabular-nums">{formatHours(p.hours, lng, 'payroll')}</span> : null}
                    <StatusPill tone={statusTone[p.status]}>{t(`timeclock.status.${p.status}`)}</StatusPill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

    </>
  );
}
