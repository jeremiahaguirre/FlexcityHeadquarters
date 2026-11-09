import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import type { CSSProperties, ReactNode } from 'react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Providers } from '@/components/Providers';
import { LOCALE_COOKIE, createI18n, normalizeLocale } from '@/lib/i18n';
import { currentTenant } from '@/lib/tenant';
import { themeVars } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = { title: 'Flexcity', description: 'Aquatic staff scheduling and operations' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tenant = await currentTenant();
  const locale = normalizeLocale(
    cookies().get(LOCALE_COOKIE)?.value ?? tenant?.defaultLocale ?? headers().get('accept-language'),
  );
  const t = createI18n(locale).t;

  return (
    <html lang={locale} style={themeVars(tenant?.themeColors) as CSSProperties}>
      <body className="min-h-screen antialiased">
        <Providers locale={locale}>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-contrast">
            {t('app.skipToContent')}
          </a>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {tenant?.logoUrl ? <img src={tenant.logoUrl} alt="" className="h-8 w-auto" /> : null}
                <span className="truncate font-semibold">{tenant?.name ?? t('app.name')}</span>
              </div>
              <LanguageToggle />
            </div>
          </header>
          <main id="main" className="mx-auto max-w-4xl px-4 py-6">
            {tenant ? children : <p role="alert">{t('app.unknownOrg')}</p>}
          </main>
        </Providers>
      </body>
    </html>
  );
}
