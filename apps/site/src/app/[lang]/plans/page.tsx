import { pageMeta } from '@/lib/seo';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { reveal } from '@/lib/reveal';
import { Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { cn } from '@/lib/cn';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).plans;
  return pageMeta(params.lang, 'plans/', c.title, c.lead);
}

export default function Plans({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).plans;
  const money = (n: number) => new Intl.NumberFormat(params.lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
  return (
    <>
      <Section>
        <SectionHead title={c.title} lead={c.lead} />
        <h2 className="mb-1 text-heading">{c.municipalTitle}</h2>
        <p className="mb-6 text-small text-muted">{c.municipalLead}</p>
        <div className="grid gap-5 md:grid-cols-3">
          {c.tiers.map((t, i) => (
            <article key={t.name} {...reveal(i)} className={cn('lift relative flex flex-col rounded-2xl border bg-panel p-6 shadow-card', 'featured' in t && t.featured ? 'border-brand ring-2 ring-brand/30' : 'border-line')}>
              <h3 className="text-heading">{t.name}</h3>
              <p className="mt-1 text-small text-muted">{t.desc}</p>
              <p className="mt-5">
                <span className="font-display text-stat">{money(t.price)}</span>
                <span className="text-small text-muted"> {c.perMonth}</span>
              </p>
              <ul className="mt-5 grid gap-2.5 text-small">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
              <Link href={`/${params.lang}/contact/?kind=SALES`} className={cn('mt-auto inline-flex h-11 items-center justify-center rounded-xl pt-0 text-body-strong', 'featured' in t && t.featured ? 'bg-brand text-brand-contrast hover:bg-brand-hover' : 'border border-line hover:bg-surface')} style={{ marginTop: '1.5rem' }}>
                {c.cta}
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <article {...reveal()} className="rounded-2xl border border-line bg-panel p-6">
            <h2 className="text-heading">{c.clubTitle}</h2>
            <p className="mt-2 text-body text-muted">{c.clubBody}</p>
            <Link href={`/${params.lang}/private-sector/`} className="mt-4 inline-block text-small font-semibold text-brand-text hover:underline">
              {copy(params.lang).home.privateCta} →
            </Link>
          </article>
          <article {...reveal(1)} className="rounded-2xl border border-line bg-panel p-6">
            <h2 className="text-heading">{c.addOnsTitle}</h2>
            <ul className="mt-3 divide-y divide-line">
              {c.addOns.map((a) => (
                <li key={a.name} className="grid gap-0.5 py-3">
                  <span className="flex justify-between gap-3 text-body-strong">
                    {a.name}
                    <span className="text-brand-text">{a.price}</span>
                  </span>
                  <span className="text-small text-muted">{a.body}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </Section>
      <Section tone="panel">
        <SectionHead title={c.implTitle} lead={c.implBody} />
        <dl className="grid gap-4 sm:grid-cols-3">
          {c.impl.map((i, n) => (
            <div key={i.who} {...reveal(n)} className="rounded-2xl bg-surface p-5">
              <dt className="text-small text-muted">{i.who}</dt>
              <dd className="mt-1 text-heading">{i.fee}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-small text-muted">{c.taxes}</p>
      </Section>
    </>
  );
}
