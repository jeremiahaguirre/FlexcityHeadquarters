/**
 * The web build this server is serving (live builds only; the static demo has none). Open tabs
 * compare it with the build they loaded (src/lib/appUpdate.ts): a different id means a reload
 * gets the newer one. Never cached (next.config.mjs).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ version: process.env.NEXT_PUBLIC_FH_VERSION ?? 'dev' }, { headers: { 'Cache-Control': 'no-store' } });
}
