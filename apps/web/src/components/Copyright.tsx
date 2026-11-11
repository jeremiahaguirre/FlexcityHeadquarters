'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { LEGAL_PAGES, legalUrl } from '@/lib/legalLinks';

/** "© 2026 FlexcityHeadquarters. All rights reserved.", then links to the legal pages on the website. */
export function Copyright({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <div className={cn('grid gap-1 text-caption text-muted', className)}>
      <p>{t('app.copyright', { year: new Date().getFullYear() })}</p>
      <nav aria-label={t('legalLinks.label')}>
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {LEGAL_PAGES.map((p) => (
            <li key={p}><a href={legalUrl(p, i18n.language)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center underline-offset-2 hover:text-ink hover:underline">{t(`legalLinks.${p}`)}</a></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
