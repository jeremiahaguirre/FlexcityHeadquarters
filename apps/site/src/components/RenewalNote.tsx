import Link from 'next/link';
import { type Lang, copy } from '@/content/copy';
import { cn } from '@/lib/cn';

/**
 * Plain-language price and renewal terms, shown right beside every "Get a quote" button: taxes,
 * that the quote confirms price, frequency and term, automatic month-to-month renewal and at what
 * price, how and by when to cancel, and the 30-day reminder (content.test checks each button has one).
 */
export function RenewalNote({ lang, dark, className }: { lang: Lang; dark?: boolean; className?: string }) {
  const c = copy(lang).plans;
  return (
    <p data-renewal-terms className={cn('text-caption', dark ? 'text-white/75' : 'text-muted', className)}>
      {c.renewalShort}{' '}
      <Link href={`/${lang}/terms/`} className={cn('font-semibold underline', dark ? 'text-white' : 'text-brand-text')}>{c.renewalTermsLink}</Link>
    </p>
  );
}
