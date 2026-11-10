import { siteOrigin } from '@/lib/publicJobs';

/** Search engines may read job postings and program sign-up; everything else is staff-only. Live sites only. */
export async function GET() {
  const origin = await siteOrigin();
  const lines = ['User-agent: *', 'Allow: /jobs', 'Allow: /signup', 'Allow: /_next/static/', 'Allow: /api/public/logo', 'Disallow: /', ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : [])];
  return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
