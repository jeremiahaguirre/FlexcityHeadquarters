'use client';

import { Upload } from 'lucide-react';
import { type InputHTMLAttributes, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A file picker that matches the app's buttons in both themes and both
 * languages (the browser's own control is grey and always in its language).
 */
export function FileInput({ id, onFile, fileName, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & { id: string; onFile: (f: File | undefined) => void; fileName?: string | null }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const shown = fileName ?? picked;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        {...rest}
        id={id}
        type="file"
        className="peer sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; setPicked(f?.name ?? null); onFile(f); }}
      />
      <label htmlFor={id} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-panel px-4 text-small font-semibold text-ink transition-colors hover:bg-surface peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
        <Upload className="h-4 w-4" aria-hidden="true" />
        {shown ? t('common.chooseOther') : t('common.chooseFile')}
      </label>
      <span className="min-w-0 max-w-full truncate text-small text-muted">{shown ?? t('common.noFile')}</span>
    </div>
  );
}
