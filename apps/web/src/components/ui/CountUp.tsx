'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts up to its value once, in about 0.7 s, when it first
 * appears (and eases between values after). Shows the final value straight
 * away for reduced motion, and screen readers only ever get the final value.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(value)) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    const decimals = Number.isInteger(value) && Number.isInteger(a) ? 0 : 2;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      const eased = 1 - (1 - p) ** 3;
      const n = a + (value - a) * eased;
      setShown(p === 1 ? value : Number(n.toFixed(decimals)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
