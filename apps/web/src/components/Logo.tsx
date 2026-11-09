import { useId } from 'react';

/**
 * FlexcityHeadquarters (FH) mark: a single-stroke FH ligature — one shared stem,
 * the F's arm, the H's stem, and a wave that is both the F's middle bar and the
 * H's crossbar — drawn in the four FH colours. Source of truth: /brand/fh-mark.svg.
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
      <g fill="none" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 15.5V48.5" stroke="#C5F23A" />
        <path d="M18 15.5H36" stroke="#E34234" />
        <path d="M46 15.5V48.5" stroke="#E879F9" />
        <path d="M18 33q7-6.5 14 0t14 0" stroke="#FFFFFF" />
      </g>
    </svg>
  );
}

/** Mark + two-line wordmark. */
export function Logo({ size = 36, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark size={size} className="shrink-0" />
      <span className="min-w-0 leading-none">
        <span className="block text-[17px] font-bold tracking-tight text-ink">Flexcity</span>
        <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-text">
          {subtitle ?? 'Headquarters'}
        </span>
      </span>
    </span>
  );
}
