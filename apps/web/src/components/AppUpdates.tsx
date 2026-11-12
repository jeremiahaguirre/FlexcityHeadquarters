'use client';

import { RefreshCw, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { DEMO } from '@/lib/demo';
import { checkForUpdate, getUpdateState, idleEnough, installDirtyTracking, markClean, markOutdated, reloadForUpdate, safeToRefresh, subscribeUpdate, type UpdateState } from '@/lib/appUpdate';

const NONE: UpdateState = { available: null, outdated: false };
const FOREGROUND_GAP_MS = 5 * 60_000;
const WALL_CHECK_MS = 30 * 60_000;

/**
 * "A new version is ready · Refresh" (lib/appUpdate.ts). Shown only while nothing is in progress;
 * refreshes by itself once the app has been hidden or untouched for a while. On the kiosk there is
 * no prompt: it refreshes between punches.
 */
export function AppUpdates() {
  const { t } = useTranslation();
  const pathname = usePathname() ?? '';
  const kiosk = pathname.startsWith('/kiosk');
  const state = useSyncExternalStore(subscribeUpdate, getUpdateState, () => NONE);
  const [later, setLater] = useState<string | null>(null);
  const [, tick] = useState(0);
  const activity = useRef({ last: Date.now(), hiddenSince: null as number | null });

  useEffect(() => (DEMO ? undefined : installDirtyTracking()), []);
  // Another screen: whatever was typed on the last one is gone or saved.
  useEffect(() => markClean(), [pathname]);

  // Look for a newer build when the app comes back to the front, and now and then on screens left open.
  useEffect(() => {
    if (DEMO) return;
    let last = Date.now();
    const front = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < FOREGROUND_GAP_MS) return;
      last = Date.now();
      void checkForUpdate();
    };
    const wall = setInterval(() => document.visibilityState === 'visible' && void checkForUpdate(), WALL_CHECK_MS);
    document.addEventListener('visibilitychange', front);
    window.addEventListener('focus', front);
    return () => {
      clearInterval(wall);
      document.removeEventListener('visibilitychange', front);
      window.removeEventListener('focus', front);
    };
  }, []);

  // Once a new build is out: watch for a quiet moment.
  const pending = !!state.available || state.outdated;
  useEffect(() => {
    if (!pending) return;
    const a = activity.current;
    const touch = () => {
      a.last = Date.now();
    };
    const vis = () => {
      a.hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null;
    };
    vis();
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (!safeToRefresh()) return;
      if (state.outdated) return markOutdated();
      if (kiosk || idleEnough({ now: Date.now(), hiddenSince: a.hiddenSince, lastActivity: a.last })) reloadForUpdate();
    }, kiosk ? 5_000 : 15_000);
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('keydown', touch, true);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [pending, state.outdated, kiosk]);

  if (DEMO || kiosk || !pending || (!state.outdated && later === state.available) || !safeToRefresh()) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6 md:justify-end md:pr-6 print:hidden">
      <div role="status" className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-panel py-2.5 pl-3 pr-2 text-small text-ink shadow-lift">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 text-brand-text">
          <RefreshCw className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 font-semibold">{state.outdated ? t('appUpdate.outdated') : t('appUpdate.ready')}</p>
        <Button size="sm" onClick={() => reloadForUpdate()}>{t('appUpdate.refresh')}</Button>
        {state.outdated ? null : (
          <button type="button" onClick={() => setLater(state.available)} className="grid h-11 w-9 place-items-center rounded-lg text-muted hover:text-ink" aria-label={t('appUpdate.later')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
