import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Section({ id, children, className, tone = 'page' }: { id?: string; children: ReactNode; className?: string; tone?: 'page' | 'panel' | 'brand' | 'night' }) {
  const dark = tone === 'brand' || tone === 'night';
  return (
    <section id={id} className={cn('scroll-mt-20', tone === 'panel' && 'bg-panel', dark && 'night grain overflow-hidden', tone === 'night' && 'night-flat', className)}>
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-28">{children}</div>
    </section>
  );
}

/** A numbered label above a section title: "01 — Departments". */
export function Kicker({ n, children, dark = false }: { n?: string; children: ReactNode; dark?: boolean }) {
  return (
    <p className={cn('mb-4 flex items-center gap-3 text-label uppercase tracking-[0.18em]', dark ? 'text-[#5EEAD4]' : 'text-brand-text')}>
      {n ? <span className="kicker-num">{n}</span> : null}
      <span aria-hidden="true" className={cn('h-px w-8', dark ? 'bg-[#5EEAD4]/60' : 'bg-brand-text/50')} />
      <span>{children}</span>
    </p>
  );
}

export function SectionHead({ eyebrow, n, title, lead, center = false, dark = false, as: Heading = 'h2' }: { eyebrow?: string; n?: string; title: string; lead?: string; center?: boolean; dark?: boolean; as?: 'h1' | 'h2' }) {
  return (
    <div className={cn('mb-10 max-w-4xl md:mb-14', center && 'mx-auto text-center')}>
      {eyebrow ? (
        <div className={cn(center && 'flex justify-center')}>
          <Kicker n={n} dark={dark}>{eyebrow}</Kicker>
        </div>
      ) : null}
      <Heading className="text-title [text-wrap:balance]">{title}</Heading>
      {lead ? <p className={cn('mt-4 max-w-2xl text-[1.0625rem] leading-7', center && 'mx-auto', dark ? 'text-white/80' : 'text-muted')}>{lead}</p> : null}
    </div>
  );
}
