import Link from 'next/link';
import { type Lang, copy } from '@/content/copy';
import { cn } from '@/lib/cn';

/**
 * Renewal terms beside every "Get a quote" button (compliance.test checks each button has one):
 * a one-line summary (before tax, automatic month-to-month renewal at the same rates, cancel in
 * writing before the term ends) with a link to the full terms. RenewalTerms is the complete
 * paragraph (taxes, the quote confirming price, frequency and term, the commitment discount, the
 * 30-day reminder), shown once on each page that sells.
 */
export function RenewalNote({ lang, dark, className }: { lang: Lang; dark?: boolean; className?: string }) {
  return <Renewal lang={lang} dark={dark} className={className} />;
}

export function RenewalTerms({ lang, dark, className }: { lang: Lang; dark?: boolean; className?: string }) {
  return <Renewal lang={lang} dark={dark} full className={className} />;
}

function Renewal({ lang, dark, full, className }: { lang: Lang; dark?: boolean; full?: boolean; className?: string }) {
  const c = copy(lang).plans;
  return (
    <p data-renewal-terms={full ? 'full' : 'line'} className={cn(full ? 'text-small' : 'text-caption', dark ? 'text-white/75' : 'text-muted', className)}>
      {full ? c.renewalShort : c.renewalLine}{' '}
      <Link href={`/${lang}/terms/`} className={cn('font-semibold underline', dark ? 'text-white' : 'text-brand-text')}>{c.renewalTermsLink}</Link>
    </p>
  );
}
