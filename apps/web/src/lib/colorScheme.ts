'use client';

import { useEffect, useState } from 'react';

export type Scheme = 'light' | 'dark' | 'system';
export const SCHEME_KEY = 'fh-color-scheme';

/** Runs in <head> before the page paints, so a dark choice never flashes white. */
export const SCHEME_SCRIPT = `try{var s=localStorage.getItem('${SCHEME_KEY}');if(s==='light'||s==='dark')document.documentElement.dataset.theme=s}catch(e){}`;

/** Set once the header logo (LiveLogo) has drawn itself in this browser session (tab). */
export const LOGO_SEEN_KEY = 'fh-logo-seen';
/** Runs with SCHEME_SCRIPT before the first paint: later full page loads in the session show the logo still. */
export const LOGO_SEEN_SCRIPT = `try{if(sessionStorage.getItem('${LOGO_SEEN_KEY}'))document.documentElement.dataset.logoSeen='1'}catch(e){}`;

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

export function useScheme(): [Scheme, (s: Scheme) => void] {
  const [scheme, setScheme] = useState<Scheme>('system');
  useEffect(() => setScheme(readScheme()), []);
  return [scheme, (s) => { applyScheme(s); setScheme(s); }];
}
