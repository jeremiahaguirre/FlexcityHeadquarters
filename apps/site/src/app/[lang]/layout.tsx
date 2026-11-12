import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { RevealObserver } from '@/components/Motion';
import { REVEAL_BOOT } from '@/lib/reveal';
import { DemoReturn } from '@/components/DemoReturn';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteAnalytics } from '@/components/SiteAnalytics';
import { SiteHeader } from '@/components/SiteHeader';
import { LANGS, type Lang, copy } from '@/content/copy';
import { SITE_ROBOTS } from '@/lib/crawlers';
import { SITE_URL, pageMeta } from '@/lib/seo';
import '../globals.css';

// Self-hosted (SIL OFL, see src/fonts): builds never depend on Google Fonts being reachable.
// The Latin file covers English and French, accents included.
const jakarta = localFont({ src: '../../fonts/plus-jakarta-sans-latin-wght-normal.woff2', weight: '200 800', variable: '--font-sans', display: 'swap' });

export const generateStaticParams = () => LANGS.map((lang) => ({ lang }));
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0D5F59' };

export async function generateMetadata(props: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  // Only en and fr are generated (generateStaticParams).
  const params = (await props.params) as { lang: Lang };
  const c = copy(params.lang);
  return {
    ...pageMeta(params.lang, '', c.meta.title, c.meta.description),
    metadataBase: new URL(SITE_URL),
    title: { default: c.meta.title, template: '%s · FlexcityHeadquarters' },
    applicationName: 'FlexcityHeadquarters',
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/logo.png', type: 'image/png', sizes: '512x512' }], apple: '/apple-touch-icon.png' },
    formatDetection: { telephone: false },
    // Indexed by search engines; "noai, noimageai" asks AI tools not to train on it (src/lib/crawlers.ts).
    robots: SITE_ROBOTS,
  };
}

export default async function LangLayout(props: { children: ReactNode; params: Promise<{ lang: string }> }) {
  // Only en and fr are generated (generateStaticParams).
  const params = (await props.params) as { lang: Lang };
  const children = props.children;
  return (
    <html lang={params.lang === 'fr' ? 'fr-CA' : 'en-CA'} className={jakarta.variable}>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT }} />
        <RevealObserver />
        <DemoReturn />
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-contrast">
          {params.lang === 'fr' ? 'Aller au contenu' : 'Skip to content'}
        </a>
        <SiteHeader lang={params.lang} />
        <main id="main">{children}</main>
        <SiteFooter lang={params.lang} />
        {/* Vercel Web Analytics: page views and visitors, no cookies; off with GPC/DNT or the footer switch. */}
        <SiteAnalytics />
      </body>
    </html>
  );
}
