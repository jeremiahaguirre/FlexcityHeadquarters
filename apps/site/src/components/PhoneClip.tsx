'use client';

import { useEffect, useRef } from 'react';
import { useScheme } from '@/lib/useScheme';

/** One app recording in a phone frame, for page headers, in the visitor's colour scheme. Still frame only for reduced motion. */
export function PhoneClip({ clip, lang, label, className }: { clip: 'board' | 'count' | 'clock'; lang: 'en' | 'fr'; label: string; className?: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const scheme = useScheme();
  const base = `/clips/${clip}-${lang}-${scheme}`;
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    void el.play().catch(() => undefined);
  }, [base]);
  return (
    <div className={`relative mx-auto w-full max-w-[15.5rem] ${className ?? ''}`}>
      <div className={`relative overflow-hidden rounded-[2rem] border-[6px] shadow-lift ${scheme === 'dark' ? 'border-[#1d2a2c] bg-[#0b1416]' : 'border-[#0B1F22] bg-white'}`}>
        {/* key: a new source when the scheme changes */}
        <video key={base} ref={v} className="block aspect-[390/760] w-full" poster={`${base}.jpg`} muted loop playsInline preload="metadata" aria-label={label}>
          <source src={`${base}.mp4`} type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
