import type { Metadata, Viewport } from 'next';
import { KeyboardInset } from '@/components/KeyboardInset';
import localFont from 'next/font/local';
import { cookies, headers } from 'next/headers';
import type { CSSProperties, ReactNode } from 'react';
import { DemoBanner } from '@/components/DemoBanner';
import { Providers } from '@/components/Providers';
import { SkipLink } from '@/components/SkipLink';
import { ToastProvider } from '@/components/ui/Toast';
import { PRIVATE_ROBOTS } from '@/lib/crawlers';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { LOCALE_COOKIE, createI18n, normalizeLocale } from '@/lib/i18n';
import { currentTenant } from '@/lib/tenant';
import { themeVars } from '@/lib/theme';
import './globals.css';
import { BOOT_SCRIPT } from '@/lib/bootScript';

// Brand typeface (wordmark + UI). Self-hosted by Next at build time.
// Self-hosted (SIL OFL, see src/fonts): builds never depend on Google Fonts being reachable.
// The Latin file covers English and French, accents included.
const jakarta = localFont({ src: '../fonts/plus-jakarta-sans-latin-wght-normal.woff2', weight: '200 800', variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'FlexcityHeadquarters', template: '%s · FH' },
  description: 'Scheduling, timekeeping, safety and HR for municipal staff',
  applicationName: 'FlexcityHeadquarters',
  // Private app and demo: no search results, no AI training (public job pages override it in (public)/layout.tsx).
  robots: PRIVATE_ROBOTS,
};
// resizes-content: on Android the page shrinks above the keyboard, so sheets and sticky bars stay reachable.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The static demo has no server: fixed tenant, and the client applies the saved language.
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  const locale = DEMO
    ? normalizeLocale(tenant?.defaultLocale)
    : normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value ?? tenant?.defaultLocale ?? (await headers()).get('accept-language'));
  const t = createI18n(locale).t;
  // Set by middleware: lets this one inline script run under the strict script policy.
  const nonce = DEMO ? undefined : ((await headers()).get('x-nonce') ?? undefined);

  return (
    <html lang={locale} className={jakarta.variable} style={themeVars(tenant?.themeColors) as CSSProperties} suppressHydrationWarning>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        {/*
          First thing in <body>, not in <head>: it still runs before anything paints, and React never has to
          match it among the <head> scripts the bundle loader removes while the page hydrates (that race was
          React error #418 on some loads). Browsers hide a nonce from the DOM, hence suppressHydrationWarning.
        */}
        {/* eslint-disable-next-line react/no-danger */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <Providers locale={locale}>
          <SkipLink />
          <KeyboardInset />
          {DEMO ? <DemoBanner /> : null}
          <ToastProvider dismissLabel={t('common.dismiss')}>
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
