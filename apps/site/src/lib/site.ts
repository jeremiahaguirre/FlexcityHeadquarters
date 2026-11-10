/** Deployment settings (Vercel environment variables). */
export const SITE = {
  /** The live app demo (GitHub Pages). */
  demoUrl: (process.env.NEXT_PUBLIC_DEMO_URL ?? 'https://jeremiahaguirre.github.io/FlexcityHeadquarters').replace(/\/$/, ''),
  /** POST endpoint for enquiries: https://<api host>/api/marketing/leads. Unset (or unreachable) = the form asks people to try again shortly. */
  leadsUrl: process.env.NEXT_PUBLIC_LEADS_URL ?? '',
};

/** Deep link into the demo as a role, in the reader's language (the demo signs in on arrival). */
export const demoLink = (role: string, lang: 'en' | 'fr') => `${SITE.demoUrl}/login/?as=${role}&lang=${lang}`;
