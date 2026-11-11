'use client';

import { Moon, Pause, Play, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useScheme } from '@/lib/useScheme';

type Scheme = 'light' | 'dark';
interface Clip { key: string; title: string; body: string }
interface Labels { themeLabel: string; light: string; dark: string; pause: string; play: string }

/**
 * Short recordings of the real app on a phone, in the site's colour scheme, with a light/dark switch so visitors see both.
 * Muted, looping, inline; paused for people who ask for reduced motion (they get the still frame
 * and a play button), and only playing while on screen.
 */
export function AppClips({ clips, lang, labels }: { clips: Clip[]; lang: 'en' | 'fr'; labels: Labels }) {
  // Starts in the site's own colour scheme (and follows it) until the visitor picks one.
  const site = useScheme();
  const [picked, setScheme] = useState<Scheme | null>(null);
  const scheme = picked ?? site;
  const [playing, setPlaying] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  // Play only while visible (and while the visitor hasn't paused them).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const videos = () => [...el.querySelectorAll('video')];
    if (!playing) {
      videos().forEach((v) => v.pause());
      return;
    }
    const io = new IntersectionObserver(([e]) => videos().forEach((v) => (e?.isIntersecting ? void v.play().catch(() => undefined) : v.pause())), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [playing, scheme]);

  const btn = 'inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-small font-semibold transition-colors';
  return (
    <div ref={wrap}>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span className="text-small font-semibold text-muted" id="clip-theme">{labels.themeLabel}</span>
        <div role="group" aria-labelledby="clip-theme" className="inline-flex rounded-full border border-line bg-panel p-1 shadow-card">
          {(['light', 'dark'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scheme === s} onClick={() => setScheme(s)} className={cn(btn, scheme === s ? 'bg-brand text-brand-contrast' : 'text-ink hover:bg-surface')}>
              {s === 'light' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
              {s === 'light' ? labels.light : labels.dark}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing} className={cn(btn, 'border border-line bg-panel text-ink hover:bg-surface')}>
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          {playing ? labels.pause : labels.play}
        </button>
      </div>
      <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((c) => {
          const base = `/clips/${c.key}-${lang}-${scheme}`;
          return (
            <li key={c.key} className="grid content-start gap-4">
              <div className={cn('mx-auto w-full max-w-[17rem] overflow-hidden rounded-[2rem] border-[6px] shadow-lift transition-colors', scheme === 'dark' ? 'border-[#1d2a2c] bg-[#0b1416]' : 'border-[#0B1F22] bg-white')}>
                {/* key: a new source when the theme changes */}
                <video key={base} className="block aspect-[390/760] w-full" poster={`${base}.jpg`} muted loop playsInline preload="none" autoPlay={playing} aria-label={c.title}>
                  <source src={`${base}.mp4`} type="video/mp4" />
                </video>
              </div>
              <div className="text-center sm:text-left">
                <h3 className="text-subheading">{c.title}</h3>
                <p className="mt-1 text-small leading-6 text-muted">{c.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
