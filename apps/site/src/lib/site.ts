/** Deployment settings (Vercel environment variables). */
export const SITE = {
  /** The live app demo (GitHub Pages). */
  demoUrl: (process.env.NEXT_PUBLIC_DEMO_URL ?? 'https://jeremiahaguirre.github.io/FlexcityHeadquarters').replace(/\/$/, ''),
  /** POST endpoint for enquiries: https://<api host>/api/marketing/leads. Unset (or unreachable) = the form asks people to try again shortly. */
  leadsUrl: process.env.NEXT_PUBLIC_LEADS_URL ?? '',
};

/**
 * The company behind the site, for CASL sender identification (the contact form's consent request
 * must name who is asking, with a mailing address) and the copyright-notice page. Set these Vercel
 * environment variables before launch; until then the pages show obvious placeholders, never
 * invented details. The API reads the same values (COMPANY_LEGAL_NAME, COMPANY_MAILING_ADDRESS).
 */
export const COMPANY = {
  legalName: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME || '[Company legal name — set NEXT_PUBLIC_COMPANY_LEGAL_NAME]',
  /** The name the product and company trade under (the brand). */
  operatingName: 'FlexcityHeadquarters',
  /** Optional: shown only when set. */
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || '',
  /** Optional: the CRA business number, shown only when set. */
  businessNumber: process.env.NEXT_PUBLIC_COMPANY_BUSINESS_NUMBER || '',
  /** Law 25 s. 3.1 "person in charge of the protection of personal information" (PIPEDA: privacy officer). */
  privacyOfficer: {
    name: process.env.NEXT_PUBLIC_PRIVACY_OFFICER_NAME || '[Person in charge of the protection of personal information — name or title to be completed]',
    email: process.env.NEXT_PUBLIC_PRIVACY_OFFICER_EMAIL || '[Privacy officer email — to be completed]',
  },
  /** The province whose law governs the terms (owner to decide; counsel to confirm). */
  governingProvince: { en: process.env.NEXT_PUBLIC_GOVERNING_PROVINCE_EN || '[province — to be chosen by the owner]', fr: process.env.NEXT_PUBLIC_GOVERNING_PROVINCE_FR || '[province — à choisir par le propriétaire]' },
  mailingAddress: process.env.NEXT_PUBLIC_COMPANY_MAILING_ADDRESS || '[Company mailing address — set NEXT_PUBLIC_COMPANY_MAILING_ADDRESS]',
  /** Where people write to us (the contact form also works). */
  email: process.env.NEXT_PUBLIC_COMPANY_EMAIL || '[Contact email — to be completed: set NEXT_PUBLIC_COMPANY_EMAIL]',
  /** Copyright Act notice-and-notice contact (ss. 41.25–41.27): where written notices of claimed infringement go. */
  copyrightContact: {
    name: process.env.NEXT_PUBLIC_COPYRIGHT_CONTACT_NAME || '[Copyright contact name or role — to be completed]',
    address: process.env.NEXT_PUBLIC_COPYRIGHT_CONTACT_ADDRESS || '[Copyright contact postal address — to be completed]',
    email: process.env.NEXT_PUBLIC_COPYRIGHT_CONTACT_EMAIL || '[Copyright notices email — to be completed]',
  },
};

/** True while a value above is still a placeholder (tests and the launch checklist read this). */
export const isPlaceholder = (v: string) => v.startsWith('[') && v.endsWith(']');

/** Settings a production build requires (next.config.mjs stops the build without them). */
export { default as REQUIRED_BUSINESS_ENV } from './requiredBusinessEnv.json';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '');

/**
 * Deep link into the demo as a role, in the reader's language (the demo signs in on arrival).
 * `back` tells the demo it was opened from this site, so it shows a "Back to the website" button;
 * the demo opened on its own (the GitHub Pages test address) has none.
 */
export const demoLink = (role: string, lang: 'en' | 'fr') => `${SITE.demoUrl}/login/?as=${role}&lang=${lang}&back=${encodeURIComponent(`${siteUrl}/${lang}/`)}`;
