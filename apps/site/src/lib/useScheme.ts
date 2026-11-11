'use client';

import { useEffect, useState } from 'react';

/** The visitor's colour scheme (light until the browser says otherwise), kept in step when it changes. */
export function useScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const q = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!q) return;
    const set = () => setScheme(q.matches ? 'dark' : 'light');
    set();
    q.addEventListener?.('change', set);
    return () => q.removeEventListener?.('change', set);
  }, []);
  return scheme;
}
