'use client';

import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'ok' | 'warn' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: ReactNode;
}
const Ctx = createContext<(message: ReactNode, tone?: ToastTone) => void>(() => undefined);

/** Short confirmations at the bottom of the screen (above the phone tab bar). At most three at once; warnings stay longer so there is time to read them. */
export function ToastProvider({ children, dismissLabel = 'Dismiss' }: { children: ReactNode; dismissLabel?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: ReactNode, tone: ToastTone = 'ok') => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-2), { id, tone, message }]);
      setTimeout(() => remove(id), tone === 'warn' ? 7000 : 4500);
    },
    [remove],
  );
  const icon = { ok: CheckCircle2, warn: AlertTriangle, info: Info };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
      >
        {items.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-small font-medium text-ink shadow-lift',
              )}
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', t.tone === 'ok' ? 'text-ok' : t.tone === 'warn' ? 'text-warn' : 'text-brand-text')} aria-hidden="true" />
              <div className="min-w-0 flex-1">{t.message}</div>
              <button type="button" onClick={() => remove(t.id)} className="-m-1 rounded-lg p-1 text-muted hover:text-ink" aria-label={dismissLabel}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
