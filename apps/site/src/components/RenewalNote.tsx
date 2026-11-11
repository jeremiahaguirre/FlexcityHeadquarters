import Link from 'next/link';
import { type Lang, copy } from '@/content/copy';
import { cn } from '@/lib/cn';

/**
 * Renewal terms beside every "Get a quote" button (compliance.test checks each button has one):
 * a short line (before tax, automatic month-to-month renewal, cancel in writing) that points to the
 * complete paragraph on the same page. RenewalTerms is that paragraph (taxes, the quote confirming
 * price, frequency and term, same rates without the commitment discount, cancel in writing before
 * the term ends, the 30-day reminder), shown once on each page that sells, with the full terms linked.
 */
export function RenewalNote({ lang, dark, compact, className }: { lang: Lang; dark?: boolean; /** Narrow cards: one short line, itself the link to the full paragraph. */ compact?: boolean; className?: string }) {
  if (compact) {
    const c = copy(lang).plans;
    return (
      <p data-renewal-terms="line" className={cn('text-caption', dark ? 'text-white/75' : 'text-muted', className)}>
        <a href="#renewal-terms" className="underline underline-offset-2 hover:text-ink">{c.renewalCompact}</a>
      </p>
    );
  }
  return <Renewal lang={lang} dark={dark} className={className} />;
}

export function RenewalTerms({ lang, dark, className }: { lang: Lang; dark?: boolean; className?: string }) {
  return <Renewal lang={lang} dark={dark} full className={className} />;
}

function Renewal({ lang, dark, full, className }: { lang: Lang; dark?: boolean; full?: boolean; className?: string }) {
  const c = copy(lang).plans;
  return (
    <p id={full ? 'renewal-terms' : undefined} data-renewal-terms={full ? 'full' : 'line'} className={cn(full ? 'scroll-mt-24 text-small' : 'text-caption', dark ? 'text-white/75' : 'text-muted', className)}>
      {full ? c.renewalShort : c.renewalLine}{' '}
      {full ? (
        <Link href={`/${lang}/terms/`} className={cn('font-semibold underline', dark ? 'text-white' : 'text-brand-text')}>{c.renewalTermsLink}</Link>
      ) : (
        <a href="#renewal-terms" className={cn('whitespace-nowrap font-semibold underline', dark ? 'text-white' : 'text-brand-text')}>{c.renewalSee}</a>
      )}
    </p>
  );
}
