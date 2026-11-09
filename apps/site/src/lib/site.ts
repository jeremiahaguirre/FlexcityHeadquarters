/** Deployment settings (Vercel environment variables). */
export const SITE = {
  /** The live app demo (GitHub Pages). */
  demoUrl: (process.env.NEXT_PUBLIC_DEMO_URL ?? 'https://jeremiahaguirre.github.io/FlexcityHeadquarters').replace(/\/$/, ''),
  /** POST endpoint for enquiries: https://<api host>/api/marketing/leads. Unset = show the email address instead. */
  leadsUrl: process.env.NEXT_PUBLIC_LEADS_URL ?? '',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@flexcityhq.example',
};

/** Deep link into the demo as a role, in the reader's language (the demo signs in on arrival). */
export const demoLink = (role: string, lang: 'en' | 'fr') =>
  role === 'DEV' ? `${SITE.demoUrl}/platform/login/?demo=1&lang=${lang}` : `${SITE.demoUrl}/login/?as=${role}&lang=${lang}`;
