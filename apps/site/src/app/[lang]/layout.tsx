import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { RevealObserver } from '@/components/Motion';
import { REVEAL_BOOT } from '@/lib/reveal';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { LANGS, type Lang, copy } from '@/content/copy';
import { SITE_URL, pageMeta } from '@/lib/seo';
import '../globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700', '800'], variable: '--font-sans', display: 'swap' });

export const generateStaticParams = () => LANGS.map((lang) => ({ lang }));
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0F766E' };

export function generateMetadata({ params }: { params: { lang: Lang } }): Metadata {
  const c = copy(params.lang);
  return {
    ...pageMeta(params.lang, '', c.meta.title, c.meta.description),
    metadataBase: new URL(SITE_URL),
    title: { default: c.meta.title, template: '%s · FlexcityHeadquarters' },
    applicationName: 'FlexcityHeadquarters',
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/logo.png', type: 'image/png', sizes: '512x512' }], apple: '/apple-touch-icon.png' },
    formatDetection: { telephone: false },
  };
}

export default function LangLayout({ children, params }: { children: ReactNode; params: { lang: Lang } }) {
  return (
    <html lang={params.lang === 'fr' ? 'fr-CA' : 'en-CA'} className={jakarta.variable}>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT }} />
        <RevealObserver />
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-contrast">
          {params.lang === 'fr' ? 'Aller au contenu' : 'Skip to content'}
        </a>
        <SiteHeader lang={params.lang} />
        <main id="main">{children}</main>
        <SiteFooter lang={params.lang} />
      </body>
    </html>
  );
}
