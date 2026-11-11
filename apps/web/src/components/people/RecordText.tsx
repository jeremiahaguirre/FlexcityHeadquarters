'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { parseRecord } from '@/lib/recordSections';

/**
 * A discipline record's text. Headings the writer left empty are hidden so it
 * doesn't read like an unfilled form; one tap shows the full record exactly as
 * signed. When the text doesn't follow the template, it's shown as is.
 */
export function RecordText({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const id = useId();
  const parsed = useMemo(() => parseRecord(text), [text]);
  const hidden = parsed?.sections.filter((s) => s.empty).length ?? 0;

  if (!parsed || !hidden) return <p className={cn('whitespace-pre-wrap', className)}>{text}</p>;

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div id={id}>
        {full ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <div className="grid gap-2">
            {parsed.preamble ? <p className="whitespace-pre-wrap">{parsed.preamble}</p> : null}
            {parsed.sections
              .filter((s) => !s.empty)
              .map((s, i) => (
                <div key={i}>
                  <p className="font-semibold">{s.heading}</p>
                  <p className="whitespace-pre-wrap">{s.body}</p>
                </div>
              ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-expanded={full}
        aria-controls={id}
        className="min-h-[44px] justify-self-start text-caption font-semibold text-brand-text hover:underline sm:min-h-0"
        onClick={() => setFull((v) => !v)}
      >
        {full ? t('people.showTidy') : t('people.showSigned')}
      </button>
      {!full ? <p className="text-caption text-muted">{t('people.hiddenEmpty', { count: hidden })}</p> : null}
    </div>
  );
}
