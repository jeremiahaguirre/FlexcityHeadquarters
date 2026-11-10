/** Deployment settings (Vercel environment variables). */
export const SITE = {
  /** The live app demo (GitHub Pages). */
  demoUrl: (process.env.NEXT_PUBLIC_DEMO_URL ?? 'https://jeremiahaguirre.github.io/FlexcityHeadquarters').replace(/\/$/, ''),
  /** POST endpoint for enquiries: https://<api host>/api/marketing/leads. Unset (or unreachable) = the form asks people to try again shortly. */
  leadsUrl: process.env.NEXT_PUBLIC_LEADS_URL ?? '',
};

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '');

/**
 * Deep link into the demo as a role, in the reader's language (the demo signs in on arrival).
 * `back` tells the demo it was opened from this site, so it shows a "Back to the website" button;
 * the demo opened on its own (the GitHub Pages test address) has none.
 */
export const demoLink = (role: string, lang: 'en' | 'fr') => `${SITE.demoUrl}/login/?as=${role}&lang=${lang}&back=${encodeURIComponent(`${siteUrl}/${lang}/`)}`;
