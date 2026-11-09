/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // In development the API runs separately; in production the load balancer
  // routes /api/* to the API service on the same origin (cookies stay first-party).
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
