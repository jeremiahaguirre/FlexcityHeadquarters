import { useId } from 'react';

/**
 * FlexcityHeadquarters (FH) mark: a city skyline over water. The chartreuse F and
 * the magenta H are buildings; the vermilion tower with lit windows between them
 * is the "city"; the white wave is the pool. Source of truth: /brand/fh-mark.svg.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${id}t`} x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B3B3C" />
          <stop offset="1" stopColor="#0F766E" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id}t)`} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 45V16M14 16H24M14 28H21" stroke="#C5F23A" strokeWidth="6" />
        <path d="M32 7.5V12" stroke="#E34234" strokeWidth="2.4" />
        <path d="M32 45V14" stroke="#E34234" strokeWidth="6" />
        <path d="M41 45V20M50 45V20M41 32H50" stroke="#E879F9" strokeWidth="6" />
        <path d="M8 52.5q6-4.5 12 0t12 0t12 0t12 0" stroke="#FFFFFF" strokeWidth="3.6" />
      </g>
      <g fill="#0B3B3C">
        <rect x="30.25" y="21" width="3.5" height="3" rx="1" />
        <rect x="30.25" y="28" width="3.5" height="3" rx="1" />
        <rect x="30.25" y="35" width="3.5" height="3" rx="1" />
      </g>
    </svg>
  );
}

/** Mark + "FcityH" wordmark with the full name beneath. */
export function Logo({ size = 38, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5" aria-label="FlexcityHeadquarters">
      <LogoMark size={size} className="shrink-0" />
      {compact ? null : (
        <span className="min-w-0 leading-none" aria-hidden="true">
          <span className="block text-[21px] font-extrabold tracking-[-0.03em] text-ink">
            F<span className="font-semibold text-brand-text">city</span>H
          </span>
          <span className="mt-1 block truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">
            Flexcity Headquarters
          </span>
        </span>
      )}
    </span>
  );
}
