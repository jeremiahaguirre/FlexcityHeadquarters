'use client';

import { BookOpen, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Lang, copy } from '@/content/copy';
import { ARTICLES, type Audience, articleIn } from '@/content/help';

/** The help centre's article list, grouped by audience, with a search that filters as you type. */
export function HelpIndex({ lang }: { lang: Lang }) {
  const c = copy(lang).help;
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const matches = ARTICLES.filter((a) => {
    const b = articleIn(a, lang);
    return !term || `${b.title} ${b.summary} ${b.steps.join(' ')}`.toLowerCase().includes(term);
  });
  const groups: Audience[] = ['staff', 'leads', 'admin'];
  return (
    <div className="grid gap-8">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input type="search" aria-label={c.search} placeholder={c.search} value={q} onChange={(e) => setQ(e.target.value)} className="h-12 w-full rounded-xl border border-line bg-panel pl-12 pr-4 text-body" />
      </div>
      {!matches.length ? <p className="text-body text-muted">{c.noResults}</p> : null}
      {groups.map((g) => {
        const list = matches.filter((a) => a.audience === g);
        if (!list.length) return null;
        return (
          <section key={g}>
            <h2 className="mb-3 text-label uppercase text-muted">{c.audience[g]}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => {
                const b = articleIn(a, lang);
                return (
                  <Link key={a.slug} href={`/${lang}/help/${a.slug}/`} className="flex gap-4 rounded-2xl border border-line bg-panel p-5 lift shadow-card">
                    <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
                    <span>
                      <span className="block text-body-strong">{b.title}</span>
                      <span className="text-small text-muted">{b.summary}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
