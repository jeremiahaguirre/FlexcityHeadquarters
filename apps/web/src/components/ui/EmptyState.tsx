import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Bubbles } from '@/components/punch/Bubbles';

/** `level` 1 when the empty state is the whole page (no page header above it), so the page still has its one h1. */
/** `celebrate`: the list was just cleared here (the last approval done): one short burst of bubbles. */
export function EmptyState({ icon: Icon, title, children, action, level = 2, celebrate = false }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode; level?: 1 | 2 | 3; celebrate?: boolean }) {
  const H = `h${level}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="relative flex flex-col items-center overflow-hidden rounded-xl2 border border-dashed border-line bg-panel px-6 py-12 text-center">
      <Bubbles burst={celebrate ? 1 : 0} />
      <span className="relative mb-5 grid h-14 w-14 place-items-center">
        <span aria-hidden="true" className="fh-ripple absolute inset-0 rounded-full border-2 border-brand/30" />
        <span aria-hidden="true" className="fh-ripple absolute inset-0 rounded-full border-2 border-brand/20 [animation-delay:1.2s]" />
        <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-text">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
      </span>
      <H className="text-subheading text-ink">{title}</H>
      {children ? <p className="mt-1.5 max-w-sm text-small text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
