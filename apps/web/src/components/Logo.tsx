import { useId } from 'react';

/**
 * FlexcityHeadquarters (FH) mark: a single-stroke FH ligature — one shared stem,
 * the F's arm, the H's stem, and a wave that is both the F's middle bar and the
 * H's crossbar. Source of truth: /brand/fh-mark.svg.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${id}t`} x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0A3D7A" />
          <stop offset="0.55" stopColor="#0B63B6" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
        <radialGradient id={`${id}g`} cx="14" cy="10" r="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id}t)`} />
      <rect width="64" height="64" rx="16" fill={`url(#${id}g)`} />
      <g fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 15.5V48.5" />
        <path d="M18 15.5H36" />
        <path d="M46 15.5V48.5" />
        <path d="M18 33q7-6.5 14 0t14 0" />
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
