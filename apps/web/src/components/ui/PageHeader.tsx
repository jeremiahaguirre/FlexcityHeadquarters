import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <p className="mb-1.5 text-label uppercase text-muted">{eyebrow}</p> : null}
        <h1 className="text-title text-ink [text-wrap:balance]">{title}</h1>
        {description ? <p className="mt-2 text-body text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
