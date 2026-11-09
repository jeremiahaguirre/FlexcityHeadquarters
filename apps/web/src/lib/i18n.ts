import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCA from '../locales/en-CA.json';
import frCA from '../locales/fr-CA.json';

export const LOCALES = ['en-CA', 'fr-CA'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'fc_locale';

export function normalizeLocale(v: string | null | undefined): Locale {
  return v?.toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA';
}

export function createI18n(locale: Locale): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en-CA',
    resources: { 'en-CA': { translation: enCA }, 'fr-CA': { translation: frCA } },
    interpolation: { escapeValue: false }, // React escapes
    initImmediate: false,
  });
  return instance;
}
