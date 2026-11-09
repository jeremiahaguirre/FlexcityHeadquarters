'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useQuery } from '@/lib/useQuery';

export interface OpenPunch { id: string; clockIn: string; localClockIn: string; facility: { name: string } }
import { type MyShift, currentShift } from '@/lib/punch';

export type { MyShift };
interface Facility { id: string; name: string }
type Loc = { lat: number; lon: number; accuracyM: number | null } | null;

/** One position fix at the moment of punching; never watched or tracked. */
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

interface PunchValue {
  enabled: boolean;
  open: OpenPunch | null;
  loading: boolean;
  shifts: MyShift[];
  /** The shift a one-tap clock-in would use. */
  suggested: MyShift | null;
  busy: 'in' | 'out' | null;
  /** One tap: the current shift, else the only facility and position, else asks. */
  clockInNow: () => Promise<void>;
  clockInFor: (body: { facilityId: string; shiftId?: string; positionId?: string }) => Promise<void>;
  askUnscheduled: () => void;
  clockOut: () => Promise<void>;
  /** Bumps after every punch so lists can refresh. */
  version: number;
}

const Ctx = createContext<PunchValue | null>(null);
export const usePunch = () => useContext(Ctx);

export function PunchProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { can, me } = useSession();
  const enabled = can('timeclock.punch');
  const [range] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.toISOString(), to: new Date(d.getTime() + 2 * 86_400_000).toISOString() };
  });
  const open = useQuery<OpenPunch | null>(enabled ? '/api/me/punch/open' : null);
  const shifts = useQuery<MyShift[]>(enabled ? `/api/me/shifts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null);
  const facilities = useQuery<Facility[]>(enabled ? '/api/facilities' : null);
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);
  const [version, setVersion] = useState(0);
  const [asking, setAsking] = useState(false);
  const [facilityId, setFacilityId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const suggested = useMemo(() => currentShift(shifts.data ?? [], now), [shifts.data, now]);

  const clockInFor = useCallback(
    async (body: { facilityId: string; shiftId?: string; positionId?: string }) => {
      setBusy('in');
      try {
        const location = await locate();
        const r = await api<{ locationStatus: string }>('/api/timeclock/in', { method: 'POST', body: { ...body, location } });
        toast(t(`timeclock.location.${r.locationStatus}`), r.locationStatus === 'VERIFIED' ? 'ok' : 'info');
        setAsking(false);
        setVersion((v) => v + 1);
        await open.reload();
      } catch (e) {
        toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
      } finally {
        setBusy(null);
      }
    },
    [open, t, toast],
  );

  const clockInNow = useCallback(async () => {
    if (suggested) return clockInFor({ facilityId: suggested.facilityId, shiftId: suggested.id });
    const fs = facilities.data ?? [];
    const ps = me?.positions ?? [];
    if (fs.length === 1 && ps.length === 1) return clockInFor({ facilityId: fs[0]!.id, positionId: ps[0]!.id });
    setFacilityId(fs.length === 1 ? fs[0]!.id : '');
    setPositionId(ps.length === 1 ? ps[0]!.id : '');
    setAsking(true);
  }, [suggested, facilities.data, me, clockInFor]);

  const clockOut = useCallback(async () => {
    setBusy('out');
    try {
      await api('/api/timeclock/out', { method: 'POST' });
      toast(t('timeclock.clockedOut'), 'ok');
      setVersion((v) => v + 1);
      await open.reload();
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }, [open, t, toast]);

  const value: PunchValue = {
    enabled,
    open: open.data ?? null,
    loading: open.loading && open.data === null,
    shifts: shifts.data ?? [],
    suggested,
    busy,
    clockInNow,
    clockInFor,
    askUnscheduled: () => setAsking(true),
    clockOut,
    version,
  };
  const lng = i18n.language;

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t('timeclock.unscheduledTitle')}
        description={t('timeclock.unscheduledHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!facilityId || !positionId} loading={busy === 'in'} onClick={() => void clockInFor({ facilityId, positionId })}>
              {t('timeclock.clockIn')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {shifts.data?.length ? (
            <p className="text-small text-muted">
              {t('punch.nextShift', { time: formatTime(shifts.data[0]!.localStartsAt, lng), place: shifts.data[0]!.facility.name })}
            </p>
          ) : null}
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
    </Ctx.Provider>
  );
}
