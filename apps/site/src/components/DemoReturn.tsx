'use client';

import { useEffect } from 'react';
import { SITE } from '@/lib/site';

const KEY = 'fh-demo-return';

/**
 * Makes the demo's "Back to the website" button return to exactly where the visitor was:
 * - every demo link's `back` is set to the page being read (path, query and #section) the
 *   moment it's pointed at, focused or tapped, so a copied link carries it too;
 * - the scroll position is saved for this tab when the demo is opened, and put back when
 *   that page loads again.
 * Without JavaScript the links still return to the home page in the visitor's language.
 */
export function DemoReturn() {
  useEffect(() => {
    const demoAnchor = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      return a && a.href.startsWith(`${SITE.demoUrl}/`) ? a : null;
    };
    const point = (e: Event) => {
      const a = demoAnchor(e);
      if (!a) return;
      const u = new URL(a.href);
      u.searchParams.set('back', window.location.href);
      a.href = u.toString();
    };
    const leave = (e: Event) => {
      if (!demoAnchor(e)) return;
      point(e);
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ path: window.location.pathname + window.location.search, y: Math.round(window.scrollY) }));
      } catch {
        /* private mode: the page still opens at the top */
      }
    };
    const events = ['pointerover', 'focusin', 'touchstart'] as const;
    for (const ev of events) document.addEventListener(ev, point, { capture: true, passive: true });
    document.addEventListener('click', leave, true);
    document.addEventListener('auxclick', leave, true);

    // Came back with the browser's own Back (page restored from memory, scroll and all): nothing to do.
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* fine */
      }
    };
    window.addEventListener('pageshow', restored);

    // Back from the demo: put the page where it was.
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { path: string; y: number } | null;
      if (saved && saved.path === window.location.pathname + window.location.search) {
        sessionStorage.removeItem(KEY);
        const go = () => window.scrollTo({ top: saved.y, behavior: 'instant' as ScrollBehavior });
        requestAnimationFrame(go);
        // Again once images and fonts have settled the layout.
        if (document.readyState === 'complete') setTimeout(go, 150);
        else window.addEventListener('load', () => setTimeout(go, 50), { once: true });
      }
    } catch {
      /* fine */
    }
    return () => {
      for (const ev of events) document.removeEventListener(ev, point, { capture: true });
      document.removeEventListener('click', leave, true);
      document.removeEventListener('auxclick', leave, true);
      window.removeEventListener('pageshow', restored);
    };
  }, []);
  return null;
}
