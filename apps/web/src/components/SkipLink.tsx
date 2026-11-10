'use client';

import { useTranslation } from 'react-i18next';

/** Follows the person's language, including in the static demo, where the server can't know it. */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-contrast">
      {t('app.skipToContent')}
    </a>
  );
}
