import AI_CRAWLERS from './aiCrawlers.json';

/**
 * Search and AI crawlers. The app is private: every page and API answer says noindex. The only exceptions are
 * an organization's public job postings and program sign-up (/jobs, /signup), which ordinary search engines may
 * index so people find the jobs; AI crawlers are kept out of those too. The AI list is a copy of the website's
 * (apps/site/src/lib/aiCrawlers.json, checked by crawlers.test.ts): the web image is built from apps/web alone.
 */
export const AI_CRAWLER_AGENTS: readonly string[] = [...AI_CRAWLERS.training, ...AI_CRAWLERS.assistants];

/** Staff-only pages (and the whole demo): out of search results and AI training. */
export const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai';
/** Public job postings and sign-up: indexed, never used for AI training. */
export const PUBLIC_ROBOTS = 'index, follow, noai, noimageai';
/** Pages that search engines may read, by path prefix. */
export const PUBLIC_PATHS = ['/jobs', '/signup'] as const;

/** The live app's robots.txt. */
export function appRobotsTxt(origin: string | null): string {
  const lines = [
    'User-agent: *',
    ...PUBLIC_PATHS.map((p) => `Allow: ${p}`),
    'Allow: /_next/static/',
    'Allow: /api/public/logo',
    'Disallow: /',
    '',
    ...AI_CRAWLER_AGENTS.map((a) => `User-agent: ${a}`),
    'Disallow: /',
    ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : []),
  ];
  return `${lines.join('\n')}\n`;
}

/** The static demo's robots.txt: nothing. (GitHub Pages only reads robots.txt at the domain root; the meta tag is what counts there.) */
export const DEMO_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';
