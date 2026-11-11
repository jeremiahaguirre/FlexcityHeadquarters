import { LiveLogo } from './LiveLogo';

export interface Organization {
  name: string;
  logoUrl: string | null;
}

/**
 * The city or municipality beside FlexcityHeadquarters. The FH logo is never
 * replaced or recoloured; an organization adds its own logo next to it, or its
 * name when it hasn't uploaded one.
 */
export function CityBrand({ org, size = 'md', showName = false }: { org: Organization; size?: 'sm' | 'md' | 'lg'; showName?: boolean }) {
  const h = { sm: 'h-6 max-w-[6.5rem]', md: 'h-8 max-w-[9rem]', lg: 'h-12 max-w-[12rem]' }[size];
  if (!org.logoUrl) {
    return <span className={size === 'lg' ? 'text-subheading font-semibold text-ink' : 'truncate text-small font-semibold text-ink'}>{org.name}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      {/* City logos are drawn for white paper: in dark mode they sit on a small light plate so navy lines stay visible. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded at runtime, served by the API */}
      <img src={org.logoUrl} alt={org.name} className={`${h} w-auto shrink-0 object-contain dark:box-content dark:rounded dark:bg-white dark:px-1 dark:py-0.5`} />
      {/* The name wraps rather than being cut off: the dark-mode plate makes the logo a little wider. */}
      {showName ? <span className="min-w-0 text-balance text-small font-semibold leading-snug text-ink">{org.name}</span> : null}
    </span>
  );
}

/**
 * "FH | City" side by side, separated by a hairline. On narrow phones the FH
 * mark stands in for the full wordmark so both fit beside the header controls.
 */
export function CoBrand({ org, logoSize = 32, citySize = 'md' }: { org: Organization; logoSize?: number; citySize?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <span className="inline-flex sm:hidden">
        <LiveLogo variant="mark" size={logoSize} />
      </span>
      <span className="hidden sm:inline-flex">
        <LiveLogo size={logoSize} />
      </span>
      <span aria-hidden="true" className="h-7 w-px shrink-0 bg-line" />
      <CityBrand org={org} size={citySize} />
    </span>
  );
}
