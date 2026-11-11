'use client';

import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguageSwitch } from './UserMenu';

export function AuthLanguageSwitch() {
  const { t } = useTranslation();
  const { switchLanguage } = useLanguageSwitch();
  return (
    <button
      type="button"
      onClick={switchLanguage}
      aria-label={t('app.languageLabel')}
      lang={t('app.languageCode')}
      className="flex h-10 items-center gap-2 rounded-full border border-line bg-panel px-4 text-small font-semibold text-ink hover:bg-surface"
    >
      <Languages className="h-4 w-4 text-muted" aria-hidden="true" />
      {t('app.language')}
    </button>
  );
}
