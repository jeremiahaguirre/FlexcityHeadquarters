import { DEMO_LOGO } from './demoLogo';
import type { PublicTenant } from './tenant';

/**
 * Static demo build (GitHub Pages): no API server, no database. Requests are
 * answered in the browser by demoApi.ts with sample data. Enabled at build time
 * with NEXT_PUBLIC_DEMO=1 (see `npm run build:demo`).
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

// In a live build (DEMO is false at build time) the sample organization, its logo, the demo
// password and accounts fold away, so none of it ships to production (ARCHITECTURE-REVIEW A15).
const SAMPLE_TENANT: PublicTenant = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'City of Lakeview (demo)',
  logoUrl: DEMO_LOGO,
  themeColors: { primary: '#0d5f59', primaryHover: '#0a4a45', primaryContrast: '#ffffff', accent: '#4c4596' },
  defaultLocale: 'en-CA',
};
export const DEMO_TENANT: PublicTenant = DEMO ? SAMPLE_TENANT : { id: '', name: '', logoUrl: null, themeColors: {}, defaultLocale: 'en-CA' };

export const DEMO_PASSWORD = DEMO ? 'flexcity-dev' : '';
const ACCOUNTS = ['guard@demo.flexcity', 'supervisor@demo.flexcity', 'hr@demo.flexcity', 'frontdesk@demo.flexcity', 'steward@demo.flexcity', 'waterworks@demo.flexcity'] as const;
export type DemoAccount = (typeof ACCOUNTS)[number];
export const DEMO_ACCOUNTS: readonly DemoAccount[] = DEMO ? ACCOUNTS : [];

/** What each demo account shows off, labelled with its role. */
const ROLES: Record<DemoAccount, string> = {
  'guard@demo.flexcity': 'STAFF',
  'supervisor@demo.flexcity': 'AQUATIC_SUPERVISOR',
  'hr@demo.flexcity': 'HR_ADMIN',
  'frontdesk@demo.flexcity': 'FRONT_DESK',
  'steward@demo.flexcity': 'UNION_STEWARD',
  'waterworks@demo.flexcity': 'EMPLOYEE',
};
export const DEMO_ROLES: Record<DemoAccount, string> = DEMO ? ROLES : ({} as Record<DemoAccount, string>);
