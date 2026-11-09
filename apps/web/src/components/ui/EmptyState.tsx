import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl2 border border-dashed border-line bg-panel px-6 py-12 text-center">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-text">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="text-subheading text-ink">{title}</h2>
      {children ? <p className="mt-1.5 max-w-sm text-small text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
