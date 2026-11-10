import type { ReactNode } from 'react';
import { LogoMark } from '@/components/Logo';
import { Kicker } from '@/components/Section';
import { cn } from '@/lib/cn';

/**
 * The header band every page shares: dark, with the FH mark large and faded behind the title
 * (easing in, then drifting; still for reduced motion), a soft glow, and room for buttons and a
 * picture beside the text. `overlap` leaves space for the next block to rise into the band.
 */
export function PageHero({ eyebrow, title, lead, children, aside, overlap = false, size = 'lg' }: { eyebrow?: string; title: string; lead?: string; children?: ReactNode; aside?: ReactNode; overlap?: boolean; size?: 'lg' | 'md' }) {
  return (
    <section className="night grain relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-20 md:-right-12 md:-top-28">
        <div className="opacity-[0.12]">
          <div className="mark-in">
            <LogoMark size={560} className="mark-breathe h-[20rem] w-[20rem] md:h-[34rem] md:w-[34rem]" />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="drift pointer-events-none absolute -left-32 bottom-[-12rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(closest-side,rgb(var(--chartreuse)/0.16),transparent)] blur-2xl" />
      <div className={cn('relative mx-auto grid max-w-7xl items-center gap-12 px-4 md:px-6', aside ? 'lg:grid-cols-[1.1fr_1fr]' : null, size === 'lg' ? 'pt-12 md:pt-20' : 'pt-10 md:pt-16', overlap ? 'pb-36 md:pb-44' : size === 'lg' ? 'pb-14 md:pb-20' : 'pb-12 md:pb-16')}>
        <div className="rise max-w-3xl">
          {eyebrow ? <Kicker dark>{eyebrow}</Kicker> : null}
          <h1 className={cn('[text-wrap:balance]', size === 'lg' ? 'text-hero2' : 'text-display')}>{title}</h1>
          {lead ? <p className="mt-5 max-w-2xl text-[1.125rem] leading-8 text-white/85">{lead}</p> : null}
          {children}
        </div>
        {aside ? <div className="rise rise-2">{aside}</div> : null}
      </div>
    </section>
  );
}
