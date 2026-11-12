import { appRobotsTxt } from '@/lib/crawlers';
import { siteOrigin } from '@/lib/publicJobs';

/** Search engines may read job postings and program sign-up; everything else is staff-only, and AI crawlers get nothing. Live sites only. */
export async function GET() {
  return new Response(appRobotsTxt(await siteOrigin()), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
