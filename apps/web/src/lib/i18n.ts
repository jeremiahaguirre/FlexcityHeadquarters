import i18next, { type Module, type i18n } from 'i18next';
import enCA from '../locales/en-CA.json';
import frCA from '../locales/fr-CA.json';

// Types only, no effect at run time. i18next 27 turned strictInterpolationChecks on by default, and
// its t() then no longer fits the (key, options?) => string helpers that take t as an argument
// (apiError.ts, useQuery.ts and others). false keeps the i18next 26 types.
declare module 'i18next' {
  interface CustomTypeOptions {
    strictInterpolationChecks: false;
  }
}

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
    initAsync: false, // initialize synchronously (i18next 24 renamed initImmediate)
  });
  return instance;
}
