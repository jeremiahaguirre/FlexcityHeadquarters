'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { LOCALE_COOKIE } from '@/lib/i18n';

/** Switches between English and Canadian French; the choice persists in a cookie. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const next = i18n.language === 'fr-CA' ? 'en-CA' : 'fr-CA';
  return (
    <button
      type="button"
      lang={next}
      aria-label={t('app.languageLabel')}
      className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        document.documentElement.lang = next;
        void i18n.changeLanguage(next);
        router.refresh();
      }}
    >
      {t('app.language')}
    </button>
  );
}
