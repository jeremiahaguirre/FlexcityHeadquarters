import { DEMO_LOGO } from './demoLogo';
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
  logoUrl: DEMO_LOGO,
  themeColors: { primary: '#0f766e', primaryHover: '#115e59', primaryContrast: '#ffffff', accent: '#c026d3' },
  defaultLocale: 'en-CA',
};

export const DEMO_PASSWORD = 'flexcity-dev';
export const DEMO_ACCOUNTS = ['guard@demo.flexcity', 'supervisor@demo.flexcity', 'hr@demo.flexcity', 'frontdesk@demo.flexcity', 'steward@demo.flexcity'] as const;
export type DemoAccount = (typeof DEMO_ACCOUNTS)[number];

/** What each demo account shows off, labelled with its role. */
export const DEMO_ROLES: Record<DemoAccount, string> = {
  'guard@demo.flexcity': 'STAFF',
  'supervisor@demo.flexcity': 'AQUATIC_SUPERVISOR',
  'hr@demo.flexcity': 'HR_ADMIN',
  'frontdesk@demo.flexcity': 'FRONT_DESK',
  'steward@demo.flexcity': 'UNION_STEWARD',
};
