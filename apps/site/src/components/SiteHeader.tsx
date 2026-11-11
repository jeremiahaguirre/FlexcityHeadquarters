'use client';

import { Languages, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type Lang, copy } from '@/content/copy';
import { demoLink } from '@/lib/site';
import { LiveLogo } from './LiveLogo';

export function SiteHeader({ lang }: { lang: Lang }) {
  const c = copy(lang);
  const pathname = usePathname() ?? `/${lang}/`;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const other: Lang = lang === 'en' ? 'fr' : 'en';
  const switchHref = pathname.replace(/^\/(en|fr)(?=\/|$)/, `/${other}`);
  const links = [
    { href: `/${lang}/product/`, label: c.nav.product },
    { href: `/${lang}/why/`, label: c.nav.why },
    { href: `/${lang}/private-sector/`, label: c.nav.privateSector },
    { href: `/${lang}/plans/`, label: c.nav.plans },
    { href: `/${lang}/demo/`, label: c.nav.demo },
    { href: `/${lang}/help/`, label: c.nav.help },
    { href: `/${lang}/contact/`, label: c.nav.contact },
  ];
  const current = (href: string) => !href.includes('#') && pathname.startsWith(href.replace(/\/$/, ''));
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-page/85 backdrop-blur supports-[backdrop-filter]:bg-page/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href={`/${lang}/`} className="rounded-xl" aria-label="FlexcityHeadquarters">
          <LiveLogo size={32} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current(l.href) ? 'page' : undefined} className="rounded-lg px-3 py-2 text-small font-semibold text-muted hover:bg-surface hover:text-ink aria-[current=page]:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href={switchHref} hrefLang={other === 'fr' ? 'fr-CA' : 'en-CA'} lang={other === 'fr' ? 'fr-CA' : 'en-CA'} aria-label={c.nav.languageLabel} className="hidden h-10 items-center gap-1.5 rounded-full border border-line px-3.5 text-small font-semibold hover:bg-surface sm:flex">
            <Languages className="h-4 w-4 text-muted" aria-hidden="true" />
            {c.nav.language}
          </Link>
          <a href={demoLink('STAFF', lang)} className="hidden h-10 items-center rounded-full bg-brand px-4 text-small font-semibold text-brand-contrast shadow-card hover:bg-brand-hover sm:flex">
            {c.nav.tryDemo}
          </a>
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface lg:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? c.nav.close : c.nav.menu} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Main" className="rise border-t border-line bg-page px-4 pb-6 pt-2 lg:hidden">
          <ul className="grid gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-xl px-3 py-3 text-body-strong hover:bg-surface">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2">
            <a href={demoLink('STAFF', lang)} className="grid h-12 place-items-center rounded-xl bg-brand text-body-strong text-brand-contrast">
              {c.nav.tryDemo}
            </a>
            <Link href={switchHref} lang={other === 'fr' ? 'fr-CA' : 'en-CA'} className="grid h-12 place-items-center rounded-xl border border-line text-body-strong">
              {c.nav.language}
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
