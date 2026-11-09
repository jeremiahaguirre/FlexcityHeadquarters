'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';

const LINKS = [
  { href: '/board', key: 'app.nav.board' },
  { href: '/status', key: 'app.nav.status' },
] as const;

export function NavLinks() {
  const { t } = useTranslation();
  const pathname = usePathname();
  if (pathname.startsWith('/login')) return null;
  return (
    <nav aria-label="Main" className="border-b border-line">
      <ul className="mx-auto flex max-w-4xl gap-1 px-4">
        {LINKS.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-block border-b-2 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  active ? 'border-brand font-medium' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t(l.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
