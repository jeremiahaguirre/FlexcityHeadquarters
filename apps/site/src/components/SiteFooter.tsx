import Link from 'next/link';
import { type Lang, copy } from '@/content/copy';
import { demoLink } from '@/lib/site';
import { Logo } from './Logo';

export function SiteFooter({ lang }: { lang: Lang }) {
  const c = copy(lang);
  const col = 'grid content-start gap-2 text-small';
  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[2fr_1fr_1fr_1fr] md:px-6">
        <div className="grid content-start gap-3">
          <Logo size={32} />
          <p className="max-w-xs text-small text-muted">{c.footer.tagline}</p>
          <p className="text-small">
            <Link href={`/${lang}/contact/`} className="font-semibold text-brand-text hover:underline">{c.contact.title}</Link>
          </p>
        </div>
        <div className={col}>
          <p className="text-label uppercase text-muted">{c.footer.product}</p>
          <Link href={`/${lang}/#product`} className="hover:underline">{c.nav.product}</Link>
          <Link href={`/${lang}/#why`} className="hover:underline">{c.nav.why}</Link>
          <Link href={`/${lang}/private-sector/`} className="hover:underline">{c.nav.privateSector}</Link>
          <Link href={`/${lang}/plans/`} className="hover:underline">{c.nav.plans}</Link>
          <a href={demoLink('STAFF', lang)} className="hover:underline">{c.nav.demo}</a>
        </div>
        <div className={col}>
          <p className="text-label uppercase text-muted">{c.footer.company}</p>
          <Link href={`/${lang}/help/`} className="hover:underline">{c.nav.help}</Link>
          <Link href={`/${lang}/faq/`} className="hover:underline">{c.nav.faq}</Link>
          <Link href={`/${lang}/contact/`} className="hover:underline">{c.nav.contact}</Link>
        </div>
        <div className={col}>
          <p className="text-label uppercase text-muted">{c.footer.legal}</p>
          <Link href={`/${lang}/privacy/`} className="hover:underline">{c.footer.privacy}</Link>
          <Link href={`/${lang}/accessibility/`} className="hover:underline">{c.footer.accessibility}</Link>
          <Link href={`/${lang}/terms/`} className="hover:underline">{c.footer.terms}</Link>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-caption text-muted md:px-6">
          <span>© {new Date().getFullYear()} FlexcityHeadquarters. {c.footer.rights}</span>
          <span>{c.footer.madeIn}</span>
        </p>
      </div>
    </footer>
  );
}
