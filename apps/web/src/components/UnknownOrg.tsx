'use client';

import { useTranslation } from 'react-i18next';
import { Logo } from './Logo';

/** Shown on an address that doesn't belong to any organization. */
export function UnknownOrg() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md place-items-center px-6 text-center">
      <div>
        <Logo variant="stacked" size={96} />
        <p role="alert" className="mt-8 text-body text-muted">
          {t('app.unknownOrg')}
        </p>
      </div>
    </main>
  );
}
