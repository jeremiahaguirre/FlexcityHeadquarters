import type { CSSProperties, ReactNode } from 'react';
import type { Lang } from '@/content/copy';
import { type ScreenName, screenAlt } from '@/content/screens';
import { cn } from '@/lib/cn';
import { reveal } from '@/lib/reveal';

/**
 * Real screenshots of the app (public/screens, from the fictional demo organization) in drawn
 * device frames: a phone, and a laptop with its base. Pure HTML/CSS, light and dark: the
 * picture follows the visitor's colour scheme with no script (a <picture> source per scheme,
 * so the browser fetches only one). Width and height are set, so nothing shifts as they load.
 * Heroes pass `priority` (loaded at once); everything else loads as it nears the screen.
 */
const SIZE = { phone: [585, 1266], laptop: [1440, 900] } as const;
const kindOf = (name: ScreenName) => (name.startsWith('phone-') ? 'phone' : 'laptop');

export function Screen({ name, lang, priority = false, className }: { name: ScreenName; lang: Lang; priority?: boolean; className?: string }) {
  const [w, h] = SIZE[kindOf(name)];
  const base = `/screens/${name}-${lang}`;
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={`${base}-dark.webp`} type="image/webp" />
      <img
        src={`${base}-light.webp`}
        alt={screenAlt(name, lang)}
        width={w}
        height={h}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        {...((priority ? { fetchpriority: 'high' } : {}) as Record<string, string>)}
        className={cn('block h-auto w-full bg-page', className)}
      />
    </picture>
  );
}

/** A phone: dark rounded frame, the screen inside, a small speaker slot. */
export function Phone({ name, lang, priority, className, children }: { name?: ScreenName; lang: Lang; priority?: boolean; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('device-phone relative w-full', className)}>
      <div className="relative overflow-hidden rounded-[11%/5.2%] border-[0.4rem] border-[#0B1F22] bg-[#0B1F22] shadow-device dark:border-[#1d2a2c] dark:bg-[#1d2a2c]">
        <div className="overflow-hidden rounded-[8.5%/4%]">{children ?? (name ? <Screen name={name} lang={lang} priority={priority} /> : null)}</div>
      </div>
    </div>
  );
}

/** A laptop: thin bezel with a camera dot, the screen, and a base wider than the lid. */
export function Laptop({ name, lang, priority, className, night = false }: { name: ScreenName; lang: Lang; priority?: boolean; className?: string; night?: boolean }) {
  return (
    <div className={cn('device-laptop relative w-full', className)}>
      <div className={cn('relative mx-[5.5%] rounded-t-[1.6%_2.6%] bg-[#0B1F22] px-[1.6%] pb-[1.9%] pt-[2.1%] shadow-device dark:bg-[#1a2829] dark:ring-1 dark:ring-white/10', night && 'ring-1 ring-white/15')}>
        <span aria-hidden="true" className="absolute left-1/2 top-[0.7%] h-[0.45rem] w-[0.45rem] -translate-x-1/2 rounded-full bg-[#24393b]" />
        <div className="overflow-hidden rounded-[0.35rem]">
          <Screen name={name} lang={lang} priority={priority} />
        </div>
      </div>
      {/* The base: a slim deck with a thumb notch, lit along its front edge. */}
      <div aria-hidden="true" className="relative h-[0.85rem] rounded-b-[1.1rem_0.9rem] bg-gradient-to-b from-[#dfe7e5] via-[#c3cfcc] to-[#97a7a4] shadow-[0_18px_30px_-16px_rgb(11_31_34/0.55)] dark:from-[#3a4d4e] dark:via-[#273839] dark:to-[#152223] sm:h-[1.05rem]">
        <span className="absolute left-1/2 top-0 h-[38%] w-[14%] -translate-x-1/2 rounded-b-lg bg-[#aab9b6] dark:bg-[#1d2c2d]" />
      </div>
    </div>
  );
}

/**
 * A laptop with a phone set in front of it, on soft shapes from the FH mark. The phone sits
 * at the front right (or left with `flip`) and floats gently when motion is allowed.
 */
export function DeviceDuo({ laptop, phone, lang, priority = false, flip = false, night = false, className, phoneNode }: { laptop: ScreenName; phone?: ScreenName; lang: Lang; priority?: boolean; flip?: boolean; night?: boolean; className?: string; phoneNode?: ReactNode }) {
  return (
    <div className={cn('relative mx-auto w-full max-w-[40rem] pb-[7%]', flip ? 'pl-[8%]' : 'pr-[8%]', className)}>
      <BrandShapes night={night} className={cn('absolute inset-x-0 -top-[10%] bottom-0 lg:-inset-x-[6%]', flip && '-scale-x-100')} />
      <div className="duo-in relative">
        <Laptop name={laptop} lang={lang} priority={priority} night={night} />
      </div>
      <div className={cn('duo-in duo-in-2 absolute bottom-0 w-[27%] min-w-[6.5rem]', flip ? 'left-0' : 'right-0')}>
        <div className="par-lift">
          <div className="float-y">{phoneNode ?? (phone ? <Phone name={phone} lang={lang} priority={priority} /> : null)}</div>
        </div>
      </div>
    </div>
  );
}

/** Two or three phones side by side, the middle one raised. */
export function PhoneRow({ names, lang, className }: { names: ScreenName[]; lang: Lang; className?: string }) {
  return (
    <div className={cn('relative mx-auto grid w-full max-w-[34rem] items-start gap-[5%]', names.length === 3 ? 'grid-cols-3' : 'grid-cols-2 max-w-[26rem]', className)}>
      <BrandShapes className="absolute inset-x-0 -inset-y-[6%] lg:-inset-x-[8%]" />
      {names.map((n, i) => (
        <div key={n} className={cn('duo-in relative', (names.length === 3 ? i === 1 : i === 0) ? 'mt-0' : 'mt-[18%]')} style={{ '--i': i } as CSSProperties}>
          <Phone name={n} lang={lang} />
        </div>
      ))}
    </div>
  );
}

/**
 * Soft shapes from the FH mark, behind device pictures: the mark's sweeping F ribbon and its
 * round city disc, in the brand teal, with one small lime dot (the accent, used sparingly).
 */
export function BrandShapes({ className, night = false }: { className?: string; night?: boolean }) {
  const fill = night ? 'fill-[#5EEAD4]/[0.07]' : 'fill-brand/[0.07] dark:fill-[#2DD4BF]/[0.07]';
  const ribbon = night ? 'fill-[#5EEAD4]/[0.09]' : 'fill-brand/[0.10] dark:fill-[#5EEAD4]/[0.08]';
  const arm = night ? 'fill-[#5EEAD4]/[0.12]' : 'fill-brand/[0.12] dark:fill-[#5EEAD4]/[0.10]';
  const ring = night ? 'stroke-[#5EEAD4]/30' : 'stroke-brand/25 dark:stroke-[#5EEAD4]/25';
  return (
    <svg aria-hidden="true" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid slice" className={cn('pointer-events-none', className)}>
      <g className="shape-drift">
        <circle cx="430" cy="250" r="190" className={fill} />
        <circle cx="430" cy="250" r="190" fill="none" strokeWidth="1.5" strokeDasharray="2 7" strokeLinecap="round" className={ring} />
      </g>
      <path
        className={cn('shape-sway', ribbon)}
        transform="translate(10 -30) scale(3.6)"
        d="M37 110C24 88 19 60 26 40 33 20 53 10 76 8.5 87 8 95 9.5 101 12.5 85 14.5 69 18.5 58 25.5 47.5 32.5 42.5 44 42.5 58 42.5 76 41.5 94 37 110Z"
      />
      <path className={arm} transform="translate(10 -30) scale(3.6)" d="M42.5 60C53 50 69 47 88 48 75 52 63 56 52 64 47.5 67 43.5 64.5 42.5 60Z" />
      <circle cx="586" cy="96" r="9" className="shape-bob fill-[#C5F23A]" />
    </svg>
  );
}

/**
 * The restrained header motif for reading pages (legal, help articles, FAQ): the mark's
 * ribbon and disc drawn as fine lines at the right edge, no screenshots.
 */
export function HeroMotif({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 120" className={cn('pointer-events-none absolute -right-16 -top-10 h-[18rem] w-[18rem] text-brand-text opacity-[0.16] md:-right-6 md:-top-16 md:h-[26rem] md:w-[26rem] dark:opacity-[0.2]', className)}>
      <g fill="none" stroke="currentColor" strokeWidth="0.55" strokeLinejoin="round">
        <path d="M37 110C24 88 19 60 26 40 33 20 53 10 76 8.5 87 8 95 9.5 101 12.5 85 14.5 69 18.5 58 25.5 47.5 32.5 42.5 44 42.5 58 42.5 76 41.5 94 37 110Z" />
        <path transform="translate(-5 -4)" strokeDasharray="1.2 2.4" d="M37 110C24 88 19 60 26 40 33 20 53 10 76 8.5 87 8 95 9.5 101 12.5 85 14.5 69 18.5 58 25.5 47.5 32.5 42.5 44 42.5 58 42.5 76 41.5 94 37 110Z" />
        <path d="M42.5 60C53 50 69 47 88 48 75 52 63 56 52 64 47.5 67 43.5 64.5 42.5 60Z" />
        <circle cx="77" cy="86" r="22" />
      </g>
      <circle cx="77" cy="86" r="22" className="fill-current opacity-[0.25]" />
    </svg>
  );
}

/**
 * A feature row: a short title and caption beside a device picture, sides alternating
 * down the page (`flip`). Text and picture rise in as they reach the screen.
 */
export function ShowRow({ kicker, title, body, visual, flip = false, children }: { kicker?: string; title: string; body: string; visual: ReactNode; flip?: boolean; children?: ReactNode }) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div {...reveal()} className={cn('max-w-xl', flip && 'lg:order-2')}>
        {kicker ? <p className="mb-3 text-label uppercase tracking-[0.14em] text-brand-text">{kicker}</p> : null}
        <h3 className="text-[1.5rem] font-extrabold leading-8 tracking-[-0.02em] md:text-[1.875rem] md:leading-10 [text-wrap:balance]">{title}</h3>
        <p className="mt-3 text-[1.0625rem] leading-7 text-muted">{body}</p>
        {children}
      </div>
      <div {...reveal(1)} className={cn(flip && 'lg:order-1')}>
        {visual}
      </div>
    </div>
  );
}
