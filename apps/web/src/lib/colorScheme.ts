'use client';

import { useEffect, useState } from 'react';

export type Scheme = 'light' | 'dark' | 'system';
import { LOGO_SEEN_KEY, SCHEME_KEY } from './bootScript';

export { SCHEME_KEY };



export function readScheme(): Scheme {
  try {
    const s = localStorage.getItem(SCHEME_KEY);
    return s === 'light' || s === 'dark' ? s : 'system';
  } catch {
    return 'system';
  }
}

export function applyScheme(s: Scheme) {
  try {
    if (s === 'system') localStorage.removeItem(SCHEME_KEY);
    else localStorage.setItem(SCHEME_KEY, s);
  } catch {
    /* private mode: still applies for this visit */
  }
  if (s === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = s;
}

/** The app's shells call this: once the header logo has drawn in, later full page loads in the tab show it still. */
export function useLogoSeen() {
  useEffect(() => {
    try {
      sessionStorage.setItem(LOGO_SEEN_KEY, '1');
    } catch {
      /* storage off: it simply draws in on every load */
    }
  }, []);
}

export function useScheme(): [Scheme, (s: Scheme) => void] {
  const [scheme, setScheme] = useState<Scheme>('system');
  useEffect(() => setScheme(readScheme()), []);
  return [scheme, (s) => { applyScheme(s); setScheme(s); }];
}
