'use client';

import { useEffect, useRef } from 'react';

/** One app recording in a phone frame, for page headers. Still frame only for reduced motion. */
export function PhoneClip({ clip, lang, label, className }: { clip: 'board' | 'count' | 'clock'; lang: 'en' | 'fr'; label: string; className?: string }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    void el.play().catch(() => undefined);
  }, []);
  const base = `/clips/${clip}-${lang}-dark`;
  return (
    <div className={`relative mx-auto w-full max-w-[15.5rem] ${className ?? ''}`}>
      <div aria-hidden="true" className="absolute -inset-8 -z-0 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.45),transparent)] blur-2xl" />
      <div className="bob relative overflow-hidden rounded-[2rem] border-[6px] border-[#1d2a2c] bg-[#0b1416] shadow-lift">
        <video ref={v} className="block aspect-[390/760] w-full" poster={`${base}.jpg`} muted loop playsInline preload="metadata" aria-label={label}>
          <source src={`${base}.mp4`} type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
