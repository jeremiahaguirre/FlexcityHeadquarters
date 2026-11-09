'use client';

import { LogIn, LogOut, PartyPopper, Waves } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/ui/Dialog';
import { SlideToConfirm } from '@/components/ui/SlideToConfirm';
import { cn } from '@/lib/cn';
import { formatTime, formatTimeRange } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Bubbles } from './Bubbles';
import { ProgressRing } from './ProgressRing';
import { usePunch } from './PunchProvider';

function useTick(active: boolean, ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}
const hm = (mins: number) => `${Math.floor(mins / 60)}:${String(Math.max(0, mins) % 60).padStart(2, '0')}`;

/** Elapsed time and, when the punch belongs to a scheduled shift, how far through it. */
function useShiftProgress() {
  const punch = usePunch();
  const now = useTick(!!punch?.open);
  if (!punch?.open) return null;
  const inAt = Date.parse(punch.open.clockIn);
  const worked = Math.max(0, Math.floor((now - inAt) / 60_000));
  const shift = punch.shifts.find((s) => Date.parse(s.startsAt) - 30 * 60_000 <= inAt && inAt < Date.parse(s.endsAt));
  const total = shift ? Math.max(1, Math.round((Date.parse(shift.endsAt) - inAt) / 60_000)) : null;
  return { worked, total, left: total ? Math.max(0, total - worked) : null, value: total ? worked / total : (worked % 60) / 60 };
}

export function PunchControl({ variant = 'compact' }: { variant?: 'compact' | 'large' }) {
  const { t } = useTranslation();
  const punch = usePunch();
  const progress = useShiftProgress();
  const [sheet, setSheet] = useState(false);
  if (!punch?.enabled) return null;
  const on = !!punch.open;

  if (variant === 'large') return <PunchCard />;

  return (
    <>
      <button
        type="button"
        disabled={punch.loading || punch.busy !== null}
        onClick={() => (on ? setSheet(true) : void punch.clockInNow())}
        aria-label={on ? t('punch.onAria', { elapsed: hm(progress?.worked ?? 0) }) : t('timeclock.clockIn')}
        className={cn(
          'flex h-10 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-small font-semibold shadow-sm transition-[background-color,transform] active:scale-95 disabled:opacity-60',
          on ? 'border border-ok/40 bg-ok-bg text-ok hover:bg-ok-bg/70' : 'bg-brand pl-3 text-brand-contrast hover:bg-brand-hover',
        )}
      >
        {on ? (
          <>
            <ProgressRing value={progress?.value ?? 0} size={28} stroke={4}>
              <span className="h-2 w-2 animate-pulse rounded-full bg-ok" />
            </ProgressRing>
            <span className="tabular-nums">{hm(progress?.worked ?? 0)}</span>
          </>
        ) : (
          <>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {punch.busy === 'in' ? t('punch.clocking') : t('punch.in')}
          </>
        )}
      </button>
      <Dialog open={sheet && on} onClose={() => setSheet(false)} title={t('timeclock.onTheClock')} closeLabel={t('common.close')}>
        <PunchCard bare onDone={() => setSheet(false)} />
      </Dialog>
    </>
  );
}

/** Today's big punch card, and the sheet behind the header pill. */
function PunchCard({ bare = false, onDone }: { bare?: boolean; onDone?: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { me } = useSession();
  const punch = usePunch()!;
  const progress = useShiftProgress();
  const [burst, setBurst] = useState(0);
  const [wrapped, setWrapped] = useState<number | null>(null);
  const on = !!punch.open;
  // Celebrate when a clock-in lands (not on page load, not when asking where).
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = punch.open?.id ?? null;
    if (prev.current === null && id) {
      setBurst((b) => b + 1);
      try {
        navigator.vibrate?.([10, 30, 10, 30, 20]);
      } catch {
        /* no haptics */
      }
    }
    prev.current = id;
  }, [punch.open?.id]);

  async function clockIn() {
    await punch.clockInNow();
  }
  async function clockOut() {
    const worked = progress?.worked ?? 0;
    await punch.clockOut();
    setWrapped(worked);
    setTimeout(() => {
      setWrapped(null);
      onDone?.();
    }, 6000);
  }

  const frame = cn('relative overflow-hidden', !bare && 'rounded-xl2 border p-5 sm:p-6');

  if (wrapped !== null && !on) {
    return (
      <div className={cn(frame, !bare && 'border-ok/40 bg-ok-bg')} role="status">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ok text-white dark:text-page">
            <PartyPopper className="h-7 w-7" aria-hidden="true" />
          </span>
          <div>
            <p className="text-heading">{t('punch.wrappedTitle', { name: me?.firstName ?? '' })}</p>
            <p className="text-small text-muted">{t('punch.wrappedBody', { time: hm(wrapped) })}</p>
          </div>
        </div>
      </div>
    );
  }

  if (on) {
    return (
      <div className={cn(frame, !bare && 'border-ok/40 bg-ok-bg')}>
        <Bubbles burst={burst} />
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
          <ProgressRing value={progress?.value ?? 0}>
            <div>
              <p className="font-display text-[1.75rem] font-extrabold leading-none tabular-nums text-ok">{hm(progress?.worked ?? 0)}</p>
              <p className="mt-1 text-caption text-muted">{t('punch.worked')}</p>
            </div>
          </ProgressRing>
          <div className="grid w-full flex-1 gap-4 text-center sm:text-left">
            <div>
              <p className="text-heading text-ok">{t('timeclock.onTheClock')}</p>
              <p className="text-small text-ink">
                {t('punch.since', { time: formatTime(punch.open!.localClockIn, lng), place: punch.open!.facility.name })}
                {progress?.left !== null && progress?.left !== undefined ? ` · ${progress.left > 0 ? t('punch.toGo', { time: hm(progress.left) }) : t('punch.overtimeNow')}` : ''}
              </p>
            </div>
            <SlideToConfirm label={t('punch.slideOut')} tone="danger" busy={punch.busy === 'out'} icon={<LogOut className="h-6 w-6" aria-hidden="true" />} onConfirm={() => void clockOut()} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(frame, !bare && 'border-brand/20 bg-[linear-gradient(135deg,rgb(var(--brand)/0.10),rgb(var(--brand)/0.02)_60%)]')}>
      <Bubbles burst={burst} />
      <Waves aria-hidden="true" className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 text-brand/10" />
      <div className="relative grid gap-4">
        <div>
          <p className="text-heading">{punch.suggested ? t('punch.readyTitle') : t('punch.noShiftTitle')}</p>
          <p className="text-small text-muted">
            {punch.suggested
              ? t('punch.forShift', { time: formatTimeRange(punch.suggested.localStartsAt, punch.suggested.localEndsAt, lng), place: punch.suggested.facility.name })
              : t('punch.noShiftNow')}
          </p>
        </div>
        <SlideToConfirm label={t('punch.slideIn')} busy={punch.busy === 'in'} icon={<LogIn className="h-6 w-6" aria-hidden="true" />} onConfirm={() => void clockIn()} />
      </div>
    </div>
  );
}
