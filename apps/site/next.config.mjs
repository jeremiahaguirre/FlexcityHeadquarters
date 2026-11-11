import { readFileSync } from 'node:fs';

// The site names who runs it (CASL sender identification, privacy officer, copyright notices,
// governing law). Until these are set the pages show bracketed placeholders, which the owner has
// accepted for production; a production build lists what is still missing in its log.
const REQUIRED = JSON.parse(readFileSync(new URL('./src/lib/requiredBusinessEnv.json', import.meta.url), 'utf8'));
const LAUNCH = process.env.VERCEL_ENV === 'production' || process.env.SITE_LAUNCH === '1';
const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
if (LAUNCH && missing.length) {
  console.warn(`Site business details still placeholders: ${missing.join(', ')} (apps/site/src/lib/site.ts).`);
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
