'use client';

import { useTranslation } from 'react-i18next';

/** Client-rendered so it follows the language toggle in the static demo. */
export function DemoBanner() {
  const { t } = useTranslation();
  return <p className="bg-brand px-4 py-2 text-center text-sm font-medium text-brand-contrast">{t('demo.banner')}</p>;
}
