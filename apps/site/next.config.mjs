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
