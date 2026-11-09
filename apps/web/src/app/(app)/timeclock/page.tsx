'use client';

import { LogIn, LogOut, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { formatDate, formatHours, formatTime, formatTimeRange } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface OpenPunch { id: string; clockIn: string; localClockIn: string; facility: { name: string } }
interface MyShift { id: string; facilityId: string; positionId: string; localStartsAt: string; localEndsAt: string; facility: { name: string }; position: { name: string; nameFr: string | null } }
interface Punch { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; localClockIn: string; localClockOut: string | null; hours: number | null; varianceReason: string | null; locationStatus: string; facility: { name: string } }
interface Facility { id: string; name: string }

type Loc = { lat: number; lon: number; accuracyM: number | null } | null;

/** Ask for one position fix; never watch or track. */
function locate(): Promise<Loc> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

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
  const toast = useToast();
  const { me } = useSession();
  const now = useNow();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const open = useQuery<OpenPunch | null>('/api/me/punch/open');
  const today = useQuery<MyShift[]>(`/api/me/shifts?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + 86_400_000).toISOString())}`);
  const recent = useQuery<Punch[]>(`/api/me/punches?from=${encodeURIComponent(new Date(start.getTime() - 14 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + 86_400_000).toISOString())}`);
  const facilities = useQuery<Facility[]>('/api/facilities');
  const { run, busy } = useAction();
  const [unscheduled, setUnscheduled] = useState(false);
  const [facilityId, setFacilityId] = useState('');
  const [positionId, setPositionId] = useState('');

  const reloadAll = () => Promise.all([open.reload(), recent.reload()]);

  async function clockIn(body: { facilityId: string; shiftId?: string; positionId?: string }) {
    const location = await locate();
    const r = await run('in', () => api<{ locationStatus: string }>('/api/timeclock/in', { method: 'POST', body: { ...body, location } }));
    if (r) {
      toast(t(`timeclock.location.${r.locationStatus}`), r.locationStatus === 'VERIFIED' ? 'ok' : 'info');
      setUnscheduled(false);
      await reloadAll();
    }
  }

  async function clockOut() {
    const r = await run('out', () => api('/api/timeclock/out', { method: 'POST' }), t('timeclock.clockedOut'));
    if (r) await reloadAll();
  }

  const elapsedH = open.data ? (now.getTime() - new Date(open.data.clockIn).getTime()) / 3_600_000 : 0;
  const statusTone = { PENDING: 'neutral', APPROVED: 'ok', REJECTED: 'warn' } as const;

  return (
    <>
      <PageHeader title={t('timeclock.title')} description={t('timeclock.description')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col items-center gap-5 p-6 text-center sm:p-8">
          <div>
            <p className="text-stat tabular-nums" aria-live="off">
              {new Intl.DateTimeFormat(lng, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(now)}
            </p>
            <p className="mt-1 text-small text-muted">{new Intl.DateTimeFormat(lng, { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</p>
          </div>
          {open.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : open.data ? (
            <div className="grid w-full gap-4">
              <div className="rounded-2xl bg-ok-bg px-4 py-3 text-ok">
                <p className="text-body-strong">{t('timeclock.onTheClock')}</p>
                <p className="text-small">
                  {t('timeclock.since', { time: formatTime(open.data.localClockIn, lng), place: open.data.facility.name })} · <span className="tabular-nums">{formatHours(Math.floor(elapsedH * 4) / 4, lng)}</span>
                </p>
              </div>
              <Button size="lg" variant="danger" block icon={<LogOut className="h-5 w-5" aria-hidden="true" />} loading={busy === 'out'} onClick={() => void clockOut()}>
                {t('timeclock.clockOut')}
              </Button>
            </div>
          ) : (
            <div className="grid w-full gap-3">
              {today.data?.map((s) => (
                <Button key={s.id} size="lg" block icon={<LogIn className="h-5 w-5" aria-hidden="true" />} loading={busy === 'in'} onClick={() => void clockIn({ facilityId: s.facilityId, shiftId: s.id })}>
                  {t('timeclock.clockInFor', { time: formatTimeRange(s.localStartsAt, s.localEndsAt, lng), place: s.facility.name })}
                </Button>
              ))}
              {!today.loading && !today.data?.length ? <p className="text-small text-muted">{t('timeclock.noShiftToday')}</p> : null}
              <Button variant="secondary" block onClick={() => setUnscheduled(true)}>
                {t('timeclock.unscheduled')}
              </Button>
            </div>
          )}
          <p className="flex items-start gap-2 text-left text-caption text-muted">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('timeclock.locationNote')}
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-subheading">{t('timeclock.recent')}</h2>
          {recent.loading ? (
            <Skeleton className="mt-4 h-40" />
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

      <Dialog
        open={unscheduled}
        onClose={() => setUnscheduled(false)}
        title={t('timeclock.unscheduledTitle')}
        description={t('timeclock.unscheduledHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnscheduled(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!facilityId || !positionId} loading={busy === 'in'} onClick={() => void clockIn({ facilityId, positionId })}>
              {t('timeclock.clockIn')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label={t('timeclock.facility')}>
            {(p) => (
              <Select {...p} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {facilities.data?.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('timeclock.position')}>
            {(p) => (
              <Select {...p} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {me?.positions.map((pos) => (
                  <option key={pos.id} value={pos.id}>
                    {lng === 'fr-CA' && pos.nameFr ? pos.nameFr : pos.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
