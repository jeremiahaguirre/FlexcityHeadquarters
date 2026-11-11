import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * One number with its label: the only stat tile in the app and the console.
 * Label in sentence case (small, muted), the value large and tabular, an optional hint line,
 * an optional icon on the left and optional extra content below (a bar, a sparkline).
 * surface "card" stands on its own in a grid; "inset" sits inside a card.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  iconClassName,
  tone,
  surface = 'card',
  className,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Tint of the icon plate, e.g. "bg-warn-bg text-warn"; brand by default. */
  iconClassName?: string;
  tone?: 'danger' | 'warn' | 'ok';
  surface?: 'card' | 'inset';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn(surface === 'card' ? 'rounded-xl2 border border-line bg-panel p-5 shadow-card' : 'rounded-xl bg-surface p-4', Icon && 'flex items-start gap-3', className)}>
      {Icon ? (
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', iconClassName ?? 'bg-brand/10 text-brand-text')}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-small text-muted">{label}</p>
        <p className={cn('mt-1 text-2xl font-bold leading-tight tabular-nums', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink')}>{value}</p>
        {hint ? <p className="mt-1 text-caption text-muted">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}
