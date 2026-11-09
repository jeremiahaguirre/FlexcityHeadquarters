import type { PublicTenant } from './tenant';

/**
 * Static demo build (GitHub Pages): no API server, no database. Requests are
 * answered in the browser by demoApi.ts with sample data. Enabled at build time
 * with NEXT_PUBLIC_DEMO=1 (see `npm run build:demo`).
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export const DEMO_TENANT: PublicTenant = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Lakeview Aquatic Centre (demo)',
  logoUrl: null,
  themeColors: { primary: '#0b5fa5', primaryHover: '#084b83', primaryContrast: '#ffffff', accent: '#0d9488' },
  defaultLocale: 'en-CA',
};

export const DEMO_PASSWORD = 'flexcity-dev';
export const DEMO_ACCOUNTS = ['guard@demo.flexcity', 'frontdesk@demo.flexcity'] as const;
