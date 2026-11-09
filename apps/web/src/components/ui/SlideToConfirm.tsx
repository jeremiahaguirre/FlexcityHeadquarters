'use client';

import { ChevronsRight } from 'lucide-react';
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
    onConfirm();
    setTimeout(() => setPos(0), 900);
  }, [onConfirm]);

  return (
    <div
      ref={track}
      className={cn(
        'relative h-16 select-none overflow-hidden rounded-full p-1 touch-pan-y',
        tone === 'brand' ? 'bg-brand/15' : 'bg-danger/12',
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
          'pointer-events-none absolute inset-0 grid place-items-center pl-12 text-body-strong transition-opacity',
          tone === 'brand' ? 'text-brand-text' : 'text-danger',
          pos > 0.35 && 'opacity-0',
        )}
      >
        <span className="flex items-center gap-1">
          {label}
          <ChevronsRight className="animate-nudge h-5 w-5" />
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
          else setPos(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setPos(0);
        }}
        className={cn(
          'relative z-10 grid h-14 w-14 cursor-grab touch-none place-items-center rounded-full shadow-lift active:cursor-grabbing',
          tone === 'brand' ? 'bg-brand text-brand-contrast' : 'bg-danger text-white dark:text-page',
          !dragging && 'transition-transform duration-300 ease-out',
        )}
        style={{ transform: `translateX(${pos * max()}px)` }}
      >
        {busy ? <Spinner /> : icon}
      </button>
    </div>
  );
}
