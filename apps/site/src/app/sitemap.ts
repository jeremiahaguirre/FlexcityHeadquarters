import type { MetadataRoute } from 'next';
import { ARTICLES } from '@/content/help';
import { PAGES, SITE_URL } from '@/lib/seo';

export const dynamic = 'force-static';

/** sitemap.xml: every page and help article in both languages, each with its other-language alternate. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...PAGES, ...ARTICLES.map((a) => `help/${a.slug}/`)];
  return paths.flatMap((p) =>
    (['en', 'fr'] as const).map((lang) => ({
      url: `${SITE_URL}/${lang}/${p}`,
      changeFrequency: p === '' || p === 'plans/' ? ('weekly' as const) : ('monthly' as const),
      priority: p === '' ? 1 : p === 'plans/' || p === 'private-sector/' || p === 'demo/' ? 0.8 : 0.5,
      alternates: { languages: { 'en-CA': `${SITE_URL}/en/${p}`, 'fr-CA': `${SITE_URL}/fr/${p}` } },
    })),
  );
}
