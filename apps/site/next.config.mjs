/** @type {import('next').NextConfig} */
// The marketing site is fully static: it deploys anywhere (Vercel, or `out/` on any host).
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};
export default nextConfig;
