import { DEMO_ROBOTS_TXT } from '@/lib/crawlers';

export const dynamic = 'force-static';

/** The static demo (GitHub Pages): nothing to index. Demo builds only (next.config.mjs pageExtensions). */
export function GET() {
  return new Response(DEMO_ROBOTS_TXT, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
