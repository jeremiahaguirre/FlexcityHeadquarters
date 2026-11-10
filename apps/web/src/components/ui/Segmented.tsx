'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** Segmented control for switching views; the highlight slides to the chosen option. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length, options.map((o) => o.label).join('|')]);
  return (
    <div ref={wrap} role="radiogroup" aria-label={label} className="relative inline-flex max-w-full overflow-x-auto rounded-xl bg-surface p-1">
      {pill ? (
        <span
          aria-hidden="true"
          className="absolute bottom-1 top-1 rounded-lg bg-panel shadow-card transition-[left,width] duration-200 ease-out"
          style={{ left: pill.left, width: pill.width }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            // Arrow keys move between options, as radio groups do.
            const i = options.findIndex((x) => x.value === value);
            const next = e.key === 'ArrowRight' ? options[(i + 1) % options.length] : e.key === 'ArrowLeft' ? options[(i - 1 + options.length) % options.length] : null;
            if (next) {
              e.preventDefault();
              onChange(next.value);
              (e.currentTarget.parentElement?.querySelectorAll('button')[options.indexOf(next)] as HTMLButtonElement | undefined)?.focus();
            }
          }}
          tabIndex={value === o.value ? 0 : -1}
          className={cn(
            'relative h-9 whitespace-nowrap rounded-lg px-3.5 text-small font-semibold transition-colors',
            value === o.value ? 'text-ink' : 'text-muted hover:text-ink',
            !pill && value === o.value && 'bg-panel shadow-card',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
