/**
 * The website's legal pages (apps/site): privacy policy, terms, cookies, accessibility, refunds,
 * copyright notices. Linked from the sign-in screens, the app's menu footer and the Dev console.
 * NEXT_PUBLIC_SITE_URL is the website's public address (set it in each deployment; the fallback is the
 * site's local development address).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3100').replace(/\/$/, '');
export const LEGAL_PAGES = ['privacy', 'terms', 'cookies', 'accessibility'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number] | 'refunds' | 'copyright';
export const legalUrl = (page: LegalPage, lng: string) => `${SITE_URL}/${lng.startsWith('fr') ? 'fr' : 'en'}/${page}/`;
