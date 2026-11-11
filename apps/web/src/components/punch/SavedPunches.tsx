'use client';

import { CloudOff, Copy, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatDate, formatTime } from '@/lib/format';
import { type QueuedPunch, deviceLocalIso } from '@/lib/offlinePunches';
import { usePunch } from './PunchProvider';

/**
 * Punches kept on this phone: waiting to send (calm, they go by themselves) or refused by the
 * server (the reason in plain words, and the details to pass on to a supervisor).
 */
export function SavedPunches({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const punch = usePunch();
  if (!punch?.queue.length) return null;
  const waiting = punch.queue.filter((p) => p.state === 'waiting');
  const refused = punch.queue.filter((p) => p.state === 'rejected');

  const describe = (p: QueuedPunch) => {
    const local = deviceLocalIso(p.occurredAt);
    const what = t(p.kind === 'in' ? 'timeclock.offline.inAt' : 'timeclock.offline.outAt', { date: formatDate(local, lng), time: formatTime(local, lng) });
    return p.place ? `${what} · ${p.place}` : what;
  };
  const reason = (p: QueuedPunch) => (p.error ? t(`errors.${p.error.code}`, { defaultValue: p.error.message }) : '');

  async function share(p: QueuedPunch) {
    const text = t('timeclock.offline.forSupervisor', { punch: describe(p), reason: reason(p) });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast(t('timeclock.offline.copied'), 'ok');
      }
    } catch {
      /* the person closed the share sheet */
    }
  }

  return (
    <div className={cn('grid gap-3', className)}>
      {waiting.length ? (
        <div className="rounded-xl border border-line bg-surface p-4" role="status">
          <div className="flex items-start gap-3">
            <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-small font-semibold">{t('timeclock.offline.savedTitle')}</p>
              <p className="text-caption text-muted">
                {punch.offline ? t('timeclock.offline.whenBack') : punch.sending ? t('timeclock.offline.sending') : t('timeclock.offline.soon')}
              </p>
              <ul className="mt-2 grid gap-1.5">
                {waiting.map((p) => (
                  <li key={p.clientId} className="flex flex-wrap items-center justify-between gap-2 text-caption tabular-nums">
                    <span className="min-w-0">{describe(p)}</span>
                    <StatusPill tone="neutral">{punch.sending ? t('timeclock.offline.sendingPill') : t('timeclock.offline.waitingPill')}</StatusPill>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {!punch.offline ? (
            <Button size="sm" variant="ghost" className="mt-2" loading={punch.sending} icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void punch.syncNow()}>
              {t('timeclock.offline.tryNow')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {refused.map((p) => (
        <div key={p.clientId} className="rounded-xl border border-warn/40 bg-warn-bg p-4" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-small font-semibold tabular-nums text-ink">{describe(p)}</p>
            <StatusPill tone="warn">{t('timeclock.offline.refusedPill')}</StatusPill>
          </div>
          <p className="mt-1 text-small text-ink">{reason(p)}</p>
          <p className="mt-1 text-caption text-muted">{t('timeclock.offline.tellSupervisor')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => void share(p)}>
              {t('timeclock.offline.share')}
            </Button>
            <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => punch.dismiss(p.clientId)}>
              {t('timeclock.offline.dismiss')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
