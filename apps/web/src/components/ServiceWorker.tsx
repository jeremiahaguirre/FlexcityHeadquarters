'use client';

import { useEffect } from 'react';
import { DEMO } from '@/lib/demo';

/** Registers the offline service worker (not in the static demo). */
export function ServiceWorker() {
  useEffect(() => {
    if (DEMO || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
