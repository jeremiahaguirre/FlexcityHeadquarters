'use client';

import { useEffect } from 'react';
import { DEMO } from '@/lib/demo';
import { captureInstallPrompt } from '@/lib/device';

if (typeof window !== 'undefined') captureInstallPrompt();

/** Registers the offline and push service worker (not in the static demo). */
export function ServiceWorker() {
  useEffect(() => {
    if (DEMO || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
