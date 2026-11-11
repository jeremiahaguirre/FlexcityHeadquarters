import type { Metadata } from 'next';
import type { Lang } from '@/content/copy';

/**
 * Public address of this site, for canonical links, hreflang and the sitemap.
 * Set NEXT_PUBLIC_SITE_URL on Vercel once a domain is attached; until then
 * Vercel's production domain is used.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3100')
).replace(/\/$/, '');

const LOCALE = { en: 'en_CA', fr: 'fr_CA' } as const;

/** Every indexable page, by path after the language (with trailing slash). */
export const PAGES = ['', 'product/', 'why/', 'private-sector/', 'plans/', 'demo/', 'faq/', 'help/', 'contact/', 'privacy/', 'accessibility/', 'terms/', 'copyright/', 'cookies/', 'refunds/'];

/** Title, description, canonical, hreflang alternates and social cards for one page. */
export function pageMeta(lang: Lang, path: string, title: string | undefined, text: string): Metadata {
  // Search results show about 160 characters: cut at a word, not mid-word.
  const description = text.length > 160 ? `${text.slice(0, text.lastIndexOf(' ', 157)).replace(/[,;:.]$/, '')}…` : text;
  const url = `/${lang}/${path}`;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: {
      canonical: url,
      languages: { 'en-CA': `/en/${path}`, 'fr-CA': `/fr/${path}`, 'x-default': `/en/${path}` },
    },
    openGraph: {
      ...(title ? { title } : {}),
      description,
      url,
      siteName: 'FlexcityHeadquarters',
      type: 'website',
      locale: LOCALE[lang],
      alternateLocale: [LOCALE[lang === 'en' ? 'fr' : 'en']],
      images: [{ url: '/screens/og.png', width: 1200, height: 630, alt: 'FlexcityHeadquarters' }],
    },
    twitter: { card: 'summary_large_image', ...(title ? { title } : {}), description, images: ['/screens/og.png'] },
  };
}
