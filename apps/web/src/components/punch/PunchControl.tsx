'use client';

import { LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { formatTime, formatTimeRange } from '@/lib/format';
import { usePunch } from './PunchProvider';

function useElapsed(since: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return '';
  const mins = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

/** The punch button: in the header everywhere ("compact"), and as a big card on Today. */
export function PunchControl({ variant = 'compact' }: { variant?: 'compact' | 'large' }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const punch = usePunch();
  const [confirmOut, setConfirmOut] = useState(false);
  const elapsed = useElapsed(punch?.open?.clockIn);
  if (!punch?.enabled) return null;
  const on = !!punch.open;

  const outDialog = (
    <Dialog
      open={confirmOut}
      onClose={() => setConfirmOut(false)}
      title={t('punch.confirmOut', { time: new Intl.DateTimeFormat(lng, { hour: 'numeric', minute: '2-digit' }).format(new Date()) })}
      description={punch.open ? t('punch.onSince', { time: formatTime(punch.open.localClockIn, lng), place: punch.open.facility.name, elapsed }) : ''}
      closeLabel={t('common.cancel')}
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmOut(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" icon={<LogOut className="h-4 w-4" aria-hidden="true" />} loading={punch.busy === 'out'} onClick={() => void punch.clockOut().then(() => setConfirmOut(false))}>
            {t('timeclock.clockOut')}
          </Button>
        </>
      }
    />
  );

  if (variant === 'compact') {
    return (
      <>
        <button
          type="button"
          disabled={punch.loading || punch.busy !== null}
          onClick={() => (on ? setConfirmOut(true) : void punch.clockInNow())}
          aria-label={on ? t('punch.onAria', { elapsed }) : t('timeclock.clockIn')}
          className={cn(
            'flex h-10 items-center gap-1.5 rounded-full px-3.5 text-small font-semibold shadow-sm transition-colors disabled:opacity-60',
            on ? 'border border-ok/40 bg-ok-bg text-ok hover:bg-ok-bg/70' : 'bg-brand text-brand-contrast hover:bg-brand-hover',
          )}
        >
          {on ? (
            <>
              <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
              </span>
              <span className="tabular-nums">{elapsed}</span>
              <span className="hidden sm:inline">· {t('timeclock.clockOut')}</span>
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {punch.busy === 'in' ? t('punch.clocking') : t('punch.in')}
            </>
          )}
        </button>
        {outDialog}
      </>
    );
  }

  // Large: Today's main action.
  return (
    <div className={cn('grid gap-3 rounded-xl2 border p-5', on ? 'border-ok/40 bg-ok-bg' : 'border-line bg-panel')}>
      {on ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body-strong text-ok">{t('timeclock.onTheClock')}</p>
              <p className="text-small text-ink">{t('punch.onSince', { time: formatTime(punch.open!.localClockIn, lng), place: punch.open!.facility.name, elapsed })}</p>
            </div>
            <p className="font-display text-title tabular-nums text-ok">{elapsed}</p>
          </div>
          <Button size="lg" variant="danger" block icon={<LogOut className="h-5 w-5" aria-hidden="true" />} onClick={() => setConfirmOut(true)}>
            {t('timeclock.clockOut')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-small text-muted">
            {punch.suggested
              ? t('punch.forShift', { time: formatTimeRange(punch.suggested.localStartsAt, punch.suggested.localEndsAt, lng), place: punch.suggested.facility.name })
              : t('punch.noShiftNow')}
          </p>
          <Button size="lg" block icon={<LogIn className="h-5 w-5" aria-hidden="true" />} loading={punch.busy === 'in'} onClick={() => void punch.clockInNow()}>
            {t('timeclock.clockIn')}
          </Button>
        </>
      )}
      {outDialog}
    </div>
  );
}
