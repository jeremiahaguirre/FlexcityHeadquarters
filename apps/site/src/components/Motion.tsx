'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One observer for the whole page: sets data-in on [data-reveal] elements when they come into view. */
export function RevealObserver() {
  const pathname = usePathname();
  useEffect(() => {
    (window as unknown as { __fhReveal?: boolean }).__fhReveal = true;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-in])'));
    const show = (el: Element) => el.setAttribute('data-in', '');
    if (!('IntersectionObserver' in window) || reduced()) {
      els.forEach(show);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          show(e.target);
          io.unobserve(e.target);
        }
      },
      // The tall top margin counts everything above the screen as seen, so a jump to an anchor or the end leaves nothing hidden.
      { rootMargin: '100000px 0px -8% 0px', threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
  return null;
}

/**
 * The countdown inside the working-alone picture. The server renders a fixed time; once
 * the page is live it ticks down each second and starts over, unless motion is reduced.
 */
export function LoneTimer({ className }: { className?: string }) {
  const START = 14 * 60 + 59;
  const [s, setS] = useState(START);
  useEffect(() => {
    if (reduced()) return;
    const id = window.setInterval(() => setS((x) => (x <= 0 ? START : x - 1)), 1000);
    return () => window.clearInterval(id);
  }, [START]);
  return <span className={className}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}
