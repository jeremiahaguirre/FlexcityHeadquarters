'use client';

import { type ReactNode, useMemo } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { type Locale, createI18n } from '@/lib/i18n';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const i18n = useMemo(() => createI18n(locale, [initReactI18next]), [locale]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
