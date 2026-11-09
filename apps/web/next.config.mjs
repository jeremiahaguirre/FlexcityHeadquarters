/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

// NEXT_PUBLIC_DEMO=1 builds a fully static demo (GitHub Pages): no server, no API.
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';
// e.g. "/FlexcityHeadquarters" when served from <user>.github.io/<repo>/
const BASE_PATH = process.env.NEXT_BASE_PATH ?? '';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig = DEMO
  ? {
      output: 'export',
      basePath: BASE_PATH,
      trailingSlash: true, // board/index.html, which static hosts serve at /board/
      // The demo previews staff imports with the API's own validation (apps/api/src/services/platform).
      experimental: { externalDir: true },
      reactStrictMode: true,
      images: { unoptimized: true },
    }
  : {
      reactStrictMode: true,
      poweredByHeader: false,
      // /api/* is proxied to the API so cookies stay first-party. In production the
      // load balancer normally routes /api/* to the API service before it reaches
      // Next; this rewrite keeps single-host deployments (and `next start`) working.
      async rewrites() {
        return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
      },
      async headers() {
        return [{ source: '/:path*', headers: securityHeaders }];
      },
    };

export default nextConfig;
