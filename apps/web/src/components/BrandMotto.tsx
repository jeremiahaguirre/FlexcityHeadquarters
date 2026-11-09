'use client';

import { useTranslation } from 'react-i18next';

/** The brand line on the sign-in panel, matching the website. */
export function BrandMotto() {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-label uppercase tracking-[0.18em] text-[#C5F23A]">{t('brand.category')}</p>
      <p className="mt-3 text-title text-white [text-wrap:balance]">{t('brand.motto')}</p>
    </>
  );
}
