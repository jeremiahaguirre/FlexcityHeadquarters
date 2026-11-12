/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
// The Union Hub's own service, when it runs separately (UNION_HUB_MODE=separate on the API).
const UNION_URL = process.env.UNION_URL;

// NEXT_PUBLIC_DEMO=1 builds a fully static demo (GitHub Pages): no server, no API.
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';
// e.g. "/FlexcityHeadquarters" when served from <user>.github.io/<repo>/
const BASE_PATH = process.env.NEXT_BASE_PATH ?? '';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  // Never framed (clickjacking); HTTPS only once deployed.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

// The app is private: no page in search results or AI training (src/lib/crawlers.ts). Public job postings and
// program sign-up stay indexable; a later rule with the same key wins in Next, so these override the first.
const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai';
const PUBLIC_ROBOTS = 'index, follow, noai, noimageai';
const robotsHeaders = [
  { source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: PRIVATE_ROBOTS }] },
  ...['/jobs', '/jobs/:path*', '/signup', '/signup/:path*'].map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: PUBLIC_ROBOTS }] })),
];

const nextConfig = DEMO
  ? {
      output: 'export',
      basePath: BASE_PATH,
      trailingSlash: true, // board/index.html, which static hosts serve at /board/
      // The demo previews staff imports with the API's own validation (apps/api/src/services/platform).
      experimental: { externalDir: true },
      // "*.demo.ts" files exist only in the demo (its robots.txt); live builds ignore them.
      pageExtensions: ['tsx', 'ts', 'demo.ts'],
      reactStrictMode: true,
      images: { unoptimized: true },
    }
  : {
      reactStrictMode: true,
      poweredByHeader: false,
      // "*.live.tsx" pages and middleware.live.ts need a server: only live builds include them.
      pageExtensions: ['tsx', 'ts', 'live.tsx', 'live.ts'],
      // /api/* is proxied to the API so cookies stay first-party. In production the
      // load balancer normally routes /api/* to the API service before it reaches
      // Next; this rewrite keeps single-host deployments (and `next start`) working.
      async rewrites() {
        return [...(UNION_URL ? [{ source: '/api/union/:path*', destination: `${UNION_URL}/api/union/:path*` }] : []), { source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
      },
      async headers() {
        return [
          { source: '/:path*', headers: securityHeaders },
          ...robotsHeaders,
          // The service worker is always checked for a new version, so fixes reach installed phones on the next visit.
          { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
          // App icons change only with a rebrand: a day in the browser, then revalidated.
          { source: '/:icon(icon-192.png|icon-512.png|icon-maskable-512.png)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, must-revalidate' }] },
        ];
      },
    };

export default nextConfig;
