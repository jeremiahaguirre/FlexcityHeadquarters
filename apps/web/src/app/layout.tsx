import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import type { CSSProperties, ReactNode } from 'react';
import { DemoBanner } from '@/components/DemoBanner';
import { Logo } from '@/components/Logo';
import { Providers } from '@/components/Providers';
import { ToastProvider } from '@/components/ui/Toast';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { LOCALE_COOKIE, createI18n, normalizeLocale } from '@/lib/i18n';
import { currentTenant } from '@/lib/tenant';
import { themeVars } from '@/lib/theme';
import './globals.css';

// Brand typeface (wordmark + UI). Self-hosted by Next at build time.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'FlexcityHeadquarters', template: '%s · FH' },
  description: 'Aquatic staff scheduling, timekeeping and operations',
  applicationName: 'FlexcityHeadquarters',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The static demo has no server: fixed tenant, and the client applies the saved language.
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  const locale = DEMO
    ? normalizeLocale(tenant?.defaultLocale)
    : normalizeLocale(cookies().get(LOCALE_COOKIE)?.value ?? tenant?.defaultLocale ?? headers().get('accept-language'));
  const t = createI18n(locale).t;

  return (
    <html lang={locale} className={jakarta.variable} style={themeVars(tenant?.themeColors) as CSSProperties}>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        <Providers locale={locale}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-contrast">
            {t('app.skipToContent')}
          </a>
          {DEMO ? <DemoBanner /> : null}
          <ToastProvider dismissLabel={t('common.dismiss')}>
            {tenant ? (
              children
            ) : (
              <main id="main" className="mx-auto grid min-h-screen max-w-md place-items-center px-6 text-center">
                <div>
                  <Logo variant="stacked" size={96} />
                  <p role="alert" className="mt-8 text-body text-muted">
                    {t('app.unknownOrg')}
                  </p>
                </div>
              </main>
            )}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
