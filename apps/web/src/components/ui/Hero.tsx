import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The top of a home screen: the day and a greeting as plain text, with an optional summary and aside.
 * No wash or motif: content cards below carry the colour.
 */
export function Hero({ eyebrow, title, children, aside, className }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="text-small font-semibold text-brand-text">{eyebrow}</p> : null}
        <h1 className="mt-1 text-title">{title}</h1>
        {children ? <div className="mt-1 text-body text-muted">{children}</div> : null}
      </div>
      {aside}
    </section>
  );
}
