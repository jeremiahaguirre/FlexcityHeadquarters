'use client';

import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Accessible modal built on <dialog> (focus trap, Esc, inert background for free).
 * Phones get a bottom sheet; larger screens a centred card.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'fh-dialog m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-line bg-panel p-0 text-ink shadow-lift backdrop:bg-overlay/50 backdrop:backdrop-blur-[2px]',
        'sm:m-auto sm:max-w-lg sm:rounded-3xl',
      )}
    >
      <div aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" />
      <div className="flex items-start justify-between gap-4 px-6 pt-4 sm:pt-6">
        <div>
          <h2 className="text-heading">{title}</h2>
          {description ? <p className="mt-1 text-small text-muted">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink" aria-label={closeLabel}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {children ? <div className="px-6 py-4">{children}</div> : null}
      {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
    </dialog>
  );
}
