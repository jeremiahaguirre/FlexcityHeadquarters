'use client';

import { useEffect, useRef, useState } from 'react';
// Relative, not '@/': the component is also loaded by Vitest, which has no path aliases.
import { type Cut, PORTRAIT_QUERY, adFiles, pickCut } from '../lib/adVideo';

interface Labels { label: string; captions: string; fallback: string; download: string }

/**
 * The 20-second FH video ad, in the page's language with its captions on, played only when the visitor
 * presses play (it has a voiceover: never autoplayed, so reduced motion is respected too).
 *
 * The cut is chosen here, on the client, before any <video> exists: the page ships a sized frame
 * (16:9, or 9:16 on a narrow portrait screen, by the same media query in CSS, so nothing jumps), and
 * once the script knows the screen it renders one <video> with one source. Only that cut's poster and
 * metadata are ever requested; the other cut is never downloaded. Turning the phone swaps the cut only
 * while nothing has been watched yet, so playback is never restarted under someone.
 */
export function AdVideo({ lang, labels, initialCut = null }: { lang: 'en' | 'fr'; labels: Labels; initialCut?: Cut | null }) {
  const [cut, setCut] = useState<Cut | null>(initialCut);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const q = window.matchMedia?.(PORTRAIT_QUERY);
    const decide = () => {
      const v = ref.current;
      if (v && (!v.paused || v.currentTime > 0)) return;
      setCut(pickCut(!!q?.matches));
    };
    decide();
    q?.addEventListener?.('change', decide);
    return () => q?.removeEventListener?.('change', decide);
  }, []);

  const frame = 'ad-frame overflow-hidden rounded-2xl border border-line bg-surface shadow-lift';
  if (!cut) return <div className={frame} data-testid="ad-placeholder" aria-hidden="true" />;
  const f = adFiles(lang, cut);
  return (
    <div className={frame} data-cut={cut}>
      {/* key: a new element (and only its own source) when the cut changes */}
      <video key={`${lang}-${cut}`} ref={ref} className="block h-full w-full" controls playsInline preload="metadata" poster={f.poster} width={f.width} height={f.height} aria-label={labels.label}>
        <source src={f.src} type="video/mp4" />
        <track kind="captions" src={f.captions} srcLang={lang} label={labels.captions} default />
        <p>
          {labels.fallback} <a href={f.src}>{labels.download}</a>
        </p>
      </video>
    </div>
  );
}
