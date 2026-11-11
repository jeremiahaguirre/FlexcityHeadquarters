import { readFileSync } from 'node:fs';

// The live site must name who runs it (CASL sender identification, privacy officer, copyright
// notices, governing law). A production build stops until every one is set; previews leave the
// missing ones out (src/components/BusinessDetails.tsx) and the legal pages show visible blanks.
const REQUIRED = JSON.parse(readFileSync(new URL('./src/lib/requiredBusinessEnv.json', import.meta.url), 'utf8'));
const LAUNCH = process.env.VERCEL_ENV === 'production' || process.env.SITE_LAUNCH === '1';
const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
if (LAUNCH && missing.length) {
  throw new Error(`Production site build stopped: set ${missing.join(', ')} (apps/site/src/lib/site.ts).`);
}

/** @type {import('next').NextConfig} */
// The marketing site is fully static: it deploys anywhere (Vercel, or `out/` on any host).
// Its public address is fixed at build time so client components (the demo links) know it too.
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3100')
).replace(/\/$/, '');
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_SITE_URL: SITE_URL },
};
export default nextConfig;
