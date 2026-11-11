'use client';

import { useEffect, useRef } from 'react';
import { onLiveChange } from './api';

/**
 * Refetch when the server announces a change to `topic` (lib/api.ts onLiveChange), instead of
 * polling. `fallbackMs` is a slow safety net for when the live stream can't connect at all
 * (a proxy that cuts long connections); leave it out for screens that aren't safety-critical.
 */
export function useLiveChange(topic: string, refetch: () => void, fallbackMs?: number) {
  const latest = useRef(refetch);
  latest.current = refetch;
  useEffect(() => {
    const off = onLiveChange(topic, () => latest.current());
    const id = fallbackMs ? setInterval(() => latest.current(), fallbackMs) : undefined;
    return () => {
      off();
      if (id) clearInterval(id);
    };
  }, [topic, fallbackMs]);
}
