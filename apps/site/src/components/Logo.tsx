import { useId } from 'react';

/**
 * FlexcityHeadquarters (FH) mark: a flowing F drawn as sweeping ribbons (with a
 * lighter layer behind for depth) beside a soft white disc holding the city —
 * an H-shaped twin tower joined by a skybridge. Source of truth: /brand/fh-mark.svg.
 */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  const p = useId().replace(/:/g, '');
  const F =
    'M37 110C24 88 19 60 26 40 33 20 53 10 76 8.5 87 8 95 9.5 101 12.5 85 14.5 69 18.5 58 25.5 47.5 32.5 42.5 44 42.5 58 42.5 76 41.5 94 37 110Z';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${p}m`} x1="30" y1="112" x2="96" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B3B3C" />
          <stop offset=".5" stopColor="#0F766E" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
        <linearGradient id={`${p}b`} x1="22" y1="104" x2="96" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14B8A6" stopOpacity=".18" />
          <stop offset=".6" stopColor="#5EEAD4" stopOpacity=".45" />
          <stop offset="1" stopColor="#C5F23A" stopOpacity=".9" />
        </linearGradient>
        <linearGradient id={`${p}a`} x1="44" y1="62" x2="92" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0F766E" />
          <stop offset="1" stopColor="#5EEAD4" />
        </linearGradient>
        <radialGradient id={`${p}d`} cx="72" cy="78" r="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".68" stopColor="#F2FAF8" />
          <stop offset="1" stopColor="#CFE9E3" />
        </radialGradient>
        <clipPath id={`${p}c`}>
          <circle cx="77" cy="86" r="22" />
        </clipPath>
      </defs>
      <path transform="translate(-5 -4)" fill={`url(#${p}b)`} d={F} />
      <path fill={`url(#${p}m)`} d={F} />
      <path fill={`url(#${p}a)`} d="M42.5 60C53 50 69 47 88 48 75 52 63 56 52 64 47.5 67 43.5 64.5 42.5 60Z" />
      <circle cx="77" cy="86" r="22" fill={`url(#${p}d)`} />
      <g clipPath={`url(#${p}c)`}>
        <g fill="#0B3B3C">
          <rect x="66" y="72" width="6.6" height="38" rx="1.5" />
          <rect x="79.4" y="77" width="6.6" height="33" rx="1.5" />
          <rect x="66" y="84.5" width="20" height="4.2" rx="1.2" />
          <rect x="89" y="92" width="5.6" height="18" rx="1.2" />
          <rect x="59.4" y="94" width="4.6" height="16" rx="1.2" />
        </g>
        <g fill="#F2FAF8">
          <rect x="68.25" y="75.5" width="2.1" height="2.5" rx=".5" />
          <rect x="68.25" y="79.6" width="2.1" height="2.5" rx=".5" />
          <rect x="81.65" y="80.5" width="2.1" height="2.5" rx=".5" />
          <rect x="68.25" y="92.5" width="2.1" height="2.5" rx=".5" />
          <rect x="81.65" y="92.5" width="2.1" height="2.5" rx=".5" />
          <rect x="68.25" y="97" width="2.1" height="2.5" rx=".5" />
          <rect x="81.65" y="97" width="2.1" height="2.5" rx=".5" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Long form. `horizontal`: mark + "FlexcityHeadquarters" on one line.
 * `stacked`: mark above "Flexcity / HEADQUARTERS". `mark`: the mark alone.
 */
export function Logo({ variant = 'horizontal', size = 40 }: { variant?: 'horizontal' | 'stacked' | 'mark'; size?: number }) {
  if (variant === 'mark') {
    return (
      <span role="img" aria-label="FlexcityHeadquarters" className="inline-flex">
        <LogoMark size={size} />
      </span>
    );
  }
  if (variant === 'stacked') {
    return (
      <span role="img" aria-label="FlexcityHeadquarters" className="inline-flex flex-col items-center gap-3 text-center">
        <LogoMark size={size} />
        <span aria-hidden="true" className="font-display leading-none">
          <span className="block text-3xl font-extrabold tracking-[-0.035em] text-ink">Flexcity</span>
          <span className="mt-2 block pl-[0.32em] text-xs font-semibold uppercase tracking-[0.32em] text-brand-text">Headquarters</span>
        </span>
      </span>
    );
  }
  return (
    <span role="img" aria-label="FlexcityHeadquarters" className="inline-flex min-w-0 items-center gap-2">
      <LogoMark size={size} className="shrink-0" />
      <span aria-hidden="true" className="truncate font-display text-[19px] leading-none tracking-[-0.035em]">
        <span className="font-extrabold text-ink">Flexcity</span>
        <span className="font-medium text-brand-text">Headquarters</span>
      </span>
    </span>
  );
}
