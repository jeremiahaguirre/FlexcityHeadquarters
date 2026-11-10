import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The top of a home screen: greeting and the day's summary on a soft brand
 * wash, with the FH ripple motif. Colour without glare.
 */
export function Hero({ eyebrow, title, children, aside, className }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={cn('relative overflow-hidden rounded-3xl border border-brand/15 bg-[linear-gradient(120deg,rgb(var(--brand)/0.16),rgb(var(--brand)/0.06)_45%,rgb(var(--chartreuse)/0.22))] px-5 py-6 sm:px-7 sm:py-7', className)}>
      <svg aria-hidden="true" viewBox="0 0 200 200" className="pointer-events-none absolute -right-10 -top-12 h-56 w-56 text-brand/15">
        {[30, 55, 80, 105].map((r) => <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />)}
      </svg>
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <p className="text-label uppercase text-brand-text">{eyebrow}</p> : null}
          <h1 className="mt-1 text-title">{title}</h1>
          {children ? <div className="mt-1 text-body text-muted">{children}</div> : null}
        </div>
        {aside}
      </div>
    </section>
  );
}
