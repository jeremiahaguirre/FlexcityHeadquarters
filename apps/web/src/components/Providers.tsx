'use client';

import { type ReactNode, useEffect, useMemo } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { DEMO } from '@/lib/demo';
import { installErrorReporting } from '@/lib/errorReporting';
import { LOCALE_COOKIE, type Locale, createI18n, normalizeLocale } from '@/lib/i18n';

/** Client-side providers for every page: translations for the chosen language, error reporting, and (static demo only) the language picked from ?lang= or the cookie. */
export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const i18n = useMemo(() => createI18n(locale, [initReactI18next]), [locale]);
  // Uncaught errors and unhandled rejections go to the API's error reporter (lib/errorReporting.ts).
  useEffect(() => installErrorReporting(), []);
  // Static demo: no server reads the language cookie, so apply it after load.
  useEffect(() => {
    if (!DEMO) return;
    // Links from the marketing site carry the reader's language: ?lang=fr.
    const asked = new URLSearchParams(window.location.search).get('lang');
    if (asked === 'fr' || asked === 'en') document.cookie = `${LOCALE_COOKIE}=${asked}-CA; path=/; max-age=31536000; samesite=lax`;
    const saved = document.cookie.split('; ').find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split('=')[1];
    if (saved) {
      const next = normalizeLocale(saved);
      document.documentElement.lang = next;
      void i18n.changeLanguage(next);
    }
  }, [i18n]);
  // Keep <html lang> in step with the language, however it was switched, so screen readers pronounce French as French.
  useEffect(() => {
    const sync = (lng: string) => {
      document.documentElement.lang = lng;
    };
    i18n.on('languageChanged', sync);
    return () => i18n.off('languageChanged', sync);
  }, [i18n]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
