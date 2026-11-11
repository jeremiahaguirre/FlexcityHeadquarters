'use client';

import { useEffect, useRef, useState } from 'react';
import { LogoMark } from './Logo';

/**
 * The FH mark drawing itself in and then staying gently alive, as on the app's
 * sign-in screen. Its motion pauses while it is scrolled out of view.
 */
export function AliveMark({ size, className }: { size: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={ref} className={visible ? 'contents' : 'contents fh-mark-paused'}>
      <LogoMark size={size} animate="hero" className={className} />
    </span>
  );
}
