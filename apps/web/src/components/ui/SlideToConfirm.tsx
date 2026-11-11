'use client';

import { Check, ChevronsRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

/**
 * Drag the thumb to the end to confirm. Deliberate enough to avoid pocket
 * taps, satisfying to do. Keyboard and screen readers: the thumb is a button,
 * Enter or Space confirms.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  tone = 'brand',
  busy = false,
  icon,
}: {
  label: string;
  onConfirm: () => void;
  tone?: 'brand' | 'danger';
  busy?: boolean;
  icon?: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; pos: number } | null>(null);
  const [pos, setPos] = useState(0); // 0..1
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);
  /** A short "done" beat after a confirm: the thumb shows a tick and the track glows once. */
  const [confirmed, setConfirmed] = useState(false);
  const THUMB = 56;
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = () => Math.max(1, width - THUMB - 8);
  const done = useCallback(() => {
    setPos(1);
    try {
      navigator.vibrate?.([12, 40, 18]);
    } catch {
      /* no haptics */
    }
    setConfirmed(true);
    onConfirm();
    setTimeout(() => {
      setPos(0);
      setConfirmed(false);
    }, 900);
  }, [onConfirm]);

  return (
    <div
      ref={track}
      className={cn(
        // Full width on phones; on larger screens a comfortable length to drag across.
        'relative h-16 w-full select-none overflow-hidden rounded-full p-1 touch-pan-y sm:max-w-[26rem]',
        confirmed && 'fh-slide-done',
        tone === 'brand' ? 'bg-brand/15' : 'bg-danger/15',
        busy && 'opacity-80',
      )}
    >
      {/* Fill behind the thumb */}
      <div
        aria-hidden="true"
        className={cn('absolute inset-y-1 left-1 rounded-full', tone === 'brand' ? 'bg-brand/25' : 'bg-danger/20', !dragging && 'transition-[width] duration-300 ease-out')}
        style={{ width: `calc(${pos} * (100% - ${THUMB + 8}px) + ${THUMB}px)` }}
      />
      <span
        aria-hidden="true"
        className={cn(
          // Text starts after the thumb (56 px + the track's 4 px padding) so long labels (French) never slide under it; they wrap instead.
          'pointer-events-none absolute inset-0 grid place-items-center pl-[4.25rem] pr-4 text-body-strong transition-opacity',
          tone === 'brand' ? 'text-brand-text' : 'text-danger',
          pos > 0.35 && 'opacity-0',
        )}
      >
        <span className="flex min-w-0 items-center gap-1 text-center leading-tight">
          <span className="min-w-0 [text-wrap:balance]">{label}</span>
          <ChevronsRight className="animate-nudge h-5 w-5 shrink-0" />
        </span>
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            done();
          }
        }}
        onClick={(e) => {
          // A click with no drag (keyboard "click", screen reader activation) confirms too.
          if (e.detail === 0) done();
        }}
        onPointerDown={(e) => {
          if (busy) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, pos };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setPos(Math.min(1, Math.max(0, start.current.pos + (e.clientX - start.current.x) / max())));
        }}
        onPointerUp={() => {
          if (!start.current) return;
          start.current = null;
          setDragging(false);
          if (pos > 0.85) done();
          else setPos(0); // springs back (the transition below)
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setPos(0);
        }}
        className={cn(
          'relative z-10 grid h-14 w-14 cursor-grab touch-none place-items-center rounded-full shadow-lift active:cursor-grabbing',
          tone === 'brand' ? 'bg-brand text-brand-contrast' : 'bg-danger text-white dark:text-page',
          // Released, it springs back (or snaps home) with a little overshoot; held, it grows slightly under the finger.
          !dragging && 'transition-transform duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)]',
        )}
        style={{ transform: `translateX(${pos * max()}px) scale(${dragging ? 1.06 : 1})` }}
      >
        {busy && !confirmed ? <Spinner /> : confirmed ? <Check className="fh-tick h-6 w-6" strokeWidth={3} aria-hidden="true" /> : icon}
      </button>
    </div>
  );
}
