import { publicJobs, siteOrigin } from '@/lib/publicJobs';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Each organization's public pages: job postings and program sign-up. Nothing that needs a sign-in. Live sites only. */
export async function GET() {
  const origin = await siteOrigin();
  if (!origin) return new Response('Not found', { status: 404 });
  const jobs = (await publicJobs()) ?? [];
  const urls = [
    { loc: `${origin}/jobs`, freq: 'daily', priority: '0.8' },
    { loc: `${origin}/signup`, freq: 'weekly', priority: '0.6' },
    ...jobs.map((j) => ({ loc: `${origin}/jobs/${j.id}`, freq: 'weekly', priority: '0.7', lastmod: j.postedOn })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u.loc)}</loc>${'lastmod' in u && u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`)
    .join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
