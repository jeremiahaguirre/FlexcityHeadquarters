import type { ReactNode } from 'react';
import { Kicker } from '@/components/Section';
import { keepHyphenated } from '@/lib/keepWords';
import { cn } from '@/lib/cn';

/**
 * The header every interior page shares: flat, lightly brand-tinted, in the visitor's own light or
 * dark scheme (only the home page has a dark hero). Room for buttons, and a picture beside the text.
 * `overlap` leaves space for the next block to rise into the band; `narrow` lines the header up with
 * a reading column (help articles, legal pages) on the same max-w-3xl left edge.
 */
export function PageHero({ eyebrow, title, lead, children, aside, overlap = false, size = 'lg', narrow = false, decoration }: { eyebrow?: string; title: string; lead?: string; children?: ReactNode; aside?: ReactNode; overlap?: boolean; size?: 'lg' | 'md'; narrow?: boolean; decoration?: ReactNode }) {
  return (
    <section className="tint relative overflow-hidden border-b border-line">
      {decoration}
      <div className={cn('relative mx-auto grid items-center gap-10 px-4 md:px-6', narrow ? 'max-w-3xl' : 'max-w-7xl', aside ? 'lg:grid-cols-[1.1fr_1fr] lg:gap-12' : null, 'pt-10 md:pt-16', overlap ? 'pb-36 md:pb-44' : 'pb-10 md:pb-14')}>
        <div className="max-w-3xl">
          {eyebrow ? <Kicker>{eyebrow}</Kicker> : null}
          <h1 className={cn('font-extrabold tracking-[-0.03em] [text-wrap:balance]', size === 'lg' ? 'text-[2.25rem] leading-[2.625rem] md:text-[3.25rem] md:leading-[3.75rem]' : 'text-[2rem] leading-[2.5rem] md:text-[2.5rem] md:leading-[3rem]')}>{keepHyphenated(title)}</h1>
          {lead ? <p className="mt-4 max-w-2xl text-[1.125rem] leading-8 text-muted">{lead}</p> : null}
          {children}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </section>
  );
}
