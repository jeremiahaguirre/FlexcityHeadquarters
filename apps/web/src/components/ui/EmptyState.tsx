import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl2 border border-dashed border-line bg-panel px-6 py-12 text-center">
      <span className="relative mb-5 grid h-14 w-14 place-items-center">
        <span aria-hidden="true" className="fh-ripple absolute inset-0 rounded-full border-2 border-brand/30" />
        <span aria-hidden="true" className="fh-ripple absolute inset-0 rounded-full border-2 border-brand/20 [animation-delay:1.2s]" />
        <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-text">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
      </span>
      <h2 className="text-subheading text-ink">{title}</h2>
      {children ? <p className="mt-1.5 max-w-sm text-small text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
