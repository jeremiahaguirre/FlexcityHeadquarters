'use client';

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The motto under the living logo on the sign-in screens (the same line as the website's hero),
 * in three beats ("Every shift. Every site. One HQ."): each rises in turn once the logo has drawn
 * itself and the wordmark has settled, and never breaks inside a beat. Still without motion.
 */
export function BrandMotto({ className }: { className?: string }) {
  const { t } = useTranslation();
  const beats = t('brand.motto').split(/(?<=\.)\s+/);
  return (
    <p className={`font-display text-[1.125rem] font-bold leading-snug sm:text-[1.25rem] tracking-[-0.02em] text-ink ${className ?? ''}`}>
      {beats.map((b, i) => (
        <span key={i}>
          {i ? ' ' : null}
          <span className={`fh-motto inline-block whitespace-nowrap ${i === beats.length - 1 ? 'text-brand-text' : ''}`} style={{ '--b': i } as CSSProperties}>
            {b.endsWith('.') ? (
              <>
                {b.slice(0, -1)}
                <span className="-ml-[0.04em]">.</span>
              </>
            ) : (
              b
            )}
          </span>
        </span>
      ))}
    </p>
  );
}

/** What FH is, on the large-screen brand panel (the motto itself sits with the logo). */
export function BrandCategory() {
  const { t } = useTranslation();
  return <p className="text-label uppercase tracking-[0.18em] text-[#C5F23A]">{t('brand.category')}</p>;
}
