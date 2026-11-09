import i18next, { type Module, type i18n } from 'i18next';
import enCA from '../locales/en-CA.json';
import frCA from '../locales/fr-CA.json';

export const LOCALES = ['en-CA', 'fr-CA'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'fc_locale';

export function normalizeLocale(v: string | null | undefined): Locale {
  return v?.toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA';
}

/**
 * Plain i18next instance — safe in server components. The client provider
 * passes react-i18next's plugin in; importing react-i18next here would break
 * server rendering (it needs React context).
 */
export function createI18n(locale: Locale, plugins: Module[] = []): i18n {
  const instance = i18next.createInstance();
  for (const p of plugins) instance.use(p);
  void instance.init({
    lng: locale,
    fallbackLng: 'en-CA',
    resources: { 'en-CA': { translation: enCA }, 'fr-CA': { translation: frCA } },
    interpolation: { escapeValue: false }, // React escapes
    initImmediate: false,
  });
  return instance;
}
