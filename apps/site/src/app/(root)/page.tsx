import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'FlexcityHeadquarters',
  description: 'Scheduling, timeclock, payroll and HR for Canadian cities · Horaires, pointage, paie et RH pour les villes canadiennes.',
  alternates: { canonical: '/en/', languages: { 'en-CA': '/en/', 'fr-CA': '/fr/', 'x-default': '/en/' } },
};

/** The bare address: send people to their language (French if the browser prefers it). */
export default function Root() {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/en/" />
      <script
        dangerouslySetInnerHTML={{
          __html: "location.replace((navigator.languages||[navigator.language]).some(function(l){return /^fr/i.test(l)})?'/fr/':'/en/')",
        }}
      />
      <p style={{ fontFamily: 'system-ui', padding: 24 }}>
        <a href="/en/">English</a> · <a href="/fr/">Français</a>
      </p>
    </>
  );
}
