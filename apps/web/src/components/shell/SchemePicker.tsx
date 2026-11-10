'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { type Scheme, useScheme } from '@/lib/colorScheme';

const OPTIONS: Array<{ value: Scheme; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/** Light, dark or follow the device: each person's own choice, kept on their device. */
export function SchemePicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [scheme, setScheme] = useScheme();
  return (
    <div role="radiogroup" aria-label={t('scheme.label')} className={cn('grid grid-cols-3 gap-1 rounded-xl bg-surface p-1', className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={scheme === o.value}
          onClick={() => setScheme(o.value)}
          title={t(`scheme.${o.value}`)}
          className={cn('flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 sm:min-h-0 text-caption font-semibold transition-colors', scheme === o.value ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink')}
        >
          <o.icon className="h-4 w-4" aria-hidden="true" />
          {t(`scheme.${o.value}`)}
        </button>
      ))}
    </div>
  );
}
