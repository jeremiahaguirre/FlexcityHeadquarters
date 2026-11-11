'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { formatTime } from '@/lib/format';
import {
  type PunchInBody,
  type QueuedPunch,
  QUEUE_EVENT,
  deviceLocalIso,
  dismissPunch,
  effectiveOpen,
  enqueuePunch,
  newPunchId,
  nextRetryAt,
  queuedPunches,
  syncPunches,
  waitingCount,
} from '@/lib/offlinePunches';
import { useSession } from '@/lib/session';
import { useQuery } from '@/lib/useQuery';

/** `pending`: saved on this phone, not sent yet. */
export interface OpenPunch { id: string; clockIn: string; localClockIn: string; facility: { name: string }; pending?: boolean }
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
  /** This person's punches kept on the phone: waiting to send, or refused by the server. */
  queue: QueuedPunch[];
  /** The browser says there's no connection. */
  offline: boolean;
  /** Sending saved punches right now. */
  sending: boolean;
  /** Try sending saved punches now. */
  syncNow: () => Promise<void>;
  /** Remove a refused punch once the person has read why. */
  dismiss: (clientId: string) => void;
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

  // ---- Offline punches: kept on this phone for this person, sent when the connection returns.
  const userId = enabled ? (me?.id ?? null) : null;
  const [queue, setQueue] = useState<QueuedPunch[]>([]);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!userId) return setQueue([]);
    const refresh = () => setQueue(queuedPunches(userId));
    refresh();
    const net = () => setOffline(navigator.onLine === false);
    net();
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    return () => {
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
    };
  }, [userId]);

  const reloadOpen = open.reload;
  const sync = useCallback(
    async (force: boolean) => {
      if (!userId || !waitingCount(userId) || navigator.onLine === false) return;
      setSending(true);
      try {
        const r = await syncPunches(userId, { force });
        if (r.sent) {
          toast(t('timeclock.offline.sentToast', { count: r.sent }), 'ok');
          setVersion((v) => v + 1);
          await reloadOpen();
        }
        if (r.rejected) toast(t('timeclock.offline.refusedToast', { count: r.rejected }), 'warn');
      } finally {
        setSending(false);
      }
    },
    [userId, toast, t, reloadOpen],
  );
  const syncRef = useRef(sync);
  syncRef.current = sync;

  // Send on load, when the connection returns and when the app comes back to the front.
  useEffect(() => {
    if (!userId) return;
    const go = () => void syncRef.current(true);
    const visible = () => document.visibilityState === 'visible' && go();
    go();
    window.addEventListener('online', go);
    window.addEventListener('focus', go);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('focus', go);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId]);

  // Retry with growing pauses while punches wait (the browser can think it's online on a dead network).
  const waiting = queue.filter((q) => q.state === 'waiting').length;
  useEffect(() => {
    if (!userId || !waiting) return;
    const due = nextRetryAt(userId) ?? Date.now();
    const id = setTimeout(() => void syncRef.current(false), Math.max(1_000, due - Date.now()));
    return () => clearTimeout(id);
  }, [userId, waiting, queue]);

  /** Keep a tap on the phone; say so calmly. */
  const keep = useCallback(
    (p: { clientId: string; kind: 'in' | 'out'; occurredAt: string; body?: PunchInBody; place?: string }) => {
      if (!userId) return;
      enqueuePunch(userId, p);
      toast(t(p.kind === 'in' ? 'timeclock.offline.savedIn' : 'timeclock.offline.savedOut'), 'info');
      setVersion((v) => v + 1);
    },
    [userId, t, toast],
  );
  /** Send live unless there's no connection or earlier punches are still waiting (they go first). */
  const mustQueue = () => navigator.onLine === false || (!!userId && waitingCount(userId) > 0);
  const unreachable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;

  const clockInFor = useCallback(
    async (body: { facilityId: string; shiftId?: string; positionId?: string }) => {
      setBusy('in');
      const occurredAt = new Date().toISOString();
      const clientId = newPunchId();
      const place = facilities.data?.find((f) => f.id === body.facilityId)?.name ?? shifts.data?.find((s) => s.id === body.shiftId)?.facility.name;
      let full: PunchInBody = { ...body, location: null };
      try {
        // The location fix is taken now, at the tap, even when the punch is sent later.
        full = { ...body, location: await locate() };
        if (mustQueue()) {
          keep({ clientId, kind: 'in', occurredAt, body: full, place });
          setAsking(false);
          return;
        }
        const r = await api<{ locationStatus: string }>('/api/timeclock/in', { method: 'POST', body: { ...full, clientId, occurredAt, sentAt: new Date().toISOString() } });
        toast(t(`timeclock.location.${r.locationStatus}`), r.locationStatus === 'VERIFIED' ? 'ok' : 'info');
        setAsking(false);
        setVersion((v) => v + 1);
        await open.reload();
      } catch (e) {
        if (unreachable(e)) {
          // Same id: if the first try did reach the server, the re-send is recognised.
          keep({ clientId, kind: 'in', occurredAt, body: full, place });
          setAsking(false);
        } else toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, t, toast, keep, facilities.data, shifts.data, userId],
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
    const occurredAt = new Date().toISOString();
    const clientId = newPunchId();
    try {
      if (mustQueue()) return keep({ clientId, kind: 'out', occurredAt });
      await api('/api/timeclock/out', { method: 'POST', body: { clientId, occurredAt, sentAt: new Date().toISOString() } });
      toast(t('timeclock.clockedOut'), 'ok');
      setVersion((v) => v + 1);
      await open.reload();
    } catch (e) {
      if (unreachable(e)) keep({ clientId, kind: 'out', occurredAt });
      else toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t, toast, keep, userId]);

  // On the clock once waiting punches count (a clock-in saved offline shows straight away).
  const eff = effectiveOpen(open.data ?? null, queue);
  const shownOpen: OpenPunch | null =
    eff.open && 'kind' in eff.open
      ? { id: eff.open.clientId, clockIn: eff.open.occurredAt, localClockIn: deviceLocalIso(eff.open.occurredAt), facility: { name: eff.open.place ?? '' }, pending: true }
      : (eff.open as OpenPunch | null);

  const value: PunchValue = {
    enabled,
    open: shownOpen,
    loading: open.loading && open.data === null && !eff.pending,
    shifts: shifts.data ?? [],
    suggested,
    busy,
    clockInNow,
    clockInFor,
    askUnscheduled: () => setAsking(true),
    clockOut,
    version,
    queue,
    offline,
    sending,
    syncNow: () => sync(true),
    dismiss: (clientId: string) => {
      if (userId) dismissPunch(userId, clientId);
    },
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
