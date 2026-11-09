import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Section({ id, children, className, tone = 'page' }: { id?: string; children: ReactNode; className?: string; tone?: 'page' | 'panel' | 'brand' }) {
  return (
    <section id={id} className={cn('scroll-mt-20', tone === 'panel' && 'bg-panel', tone === 'brand' && 'bg-[linear-gradient(150deg,#0B3B3C_0%,#0F766E_60%,#14B8A6_100%)] text-white', className)}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">{children}</div>
    </section>
  );
}

export function SectionHead({ eyebrow, title, lead, center = false }: { eyebrow?: string; title: string; lead?: string; center?: boolean }) {
  return (
    <div className={cn('mb-10 max-w-2xl', center && 'mx-auto text-center')}>
      {eyebrow ? <p className="mb-3 text-label uppercase tracking-[0.18em] text-brand-text">{eyebrow}</p> : null}
      <h2 className="text-title [text-wrap:balance]">{title}</h2>
      {lead ? <p className="mt-3 text-body text-muted">{lead}</p> : null}
    </div>
  );
}
