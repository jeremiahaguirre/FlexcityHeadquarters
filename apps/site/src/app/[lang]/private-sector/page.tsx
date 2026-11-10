import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { reveal } from '@/lib/reveal';
import { Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { pageMeta } from '@/lib/seo';
import { demoLink } from '@/lib/site';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).privateSector;
  return pageMeta(params.lang, 'private-sector/', c.title, c.metaDescription);
}

const ICONS = ['waves', 'users', 'trees', 'wrench'];

export default async function PrivateSector(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const all = copy(params.lang);
  const c = all.privateSector;
  return (
    <>
      <Section>
        <div className="rise max-w-3xl">
          <p className="mb-4 inline-flex rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-caption font-semibold text-brand-text">{all.nav.privateSector}</p>
          <h1 className="text-display [text-wrap:balance]">{c.title}</h1>
          <p className="mt-5 text-[1.0625rem] leading-7 text-muted">{c.lead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/${params.lang}/contact/?kind=SALES`} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-body-strong text-brand-contrast shadow-lift hover:bg-brand-hover">
              {c.cta}
              <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
            </Link>
            <a href={demoLink('STAFF', params.lang)} className="inline-flex h-12 items-center rounded-xl border border-line bg-panel px-6 text-body-strong hover:bg-surface">
              {all.home.ctaDemo}
            </a>
          </div>
        </div>
      </Section>
      <Section tone="panel">
        <SectionHead title={c.whoTitle} />
        <div className="grid gap-5 sm:grid-cols-2">
          {c.who.map((w, i) => (
            <article key={w.title} {...reveal(i % 2)} className="lift flex gap-4 rounded-2xl border border-line bg-panel p-6 shadow-card">
              <span className="lift-icon grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand-text">
                <Icon name={ICONS[i] ?? 'users'} />
              </span>
              <span>
                <h2 className="text-subheading">{w.title}</h2>
                <p className="mt-1.5 text-small leading-6 text-muted">{w.body}</p>
              </span>
            </article>
          ))}
        </div>
      </Section>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div {...reveal()}>
            <SectionHead title={c.whyTitle} />
            <ul className="grid gap-3">
              {c.why.map((w) => (
                <li key={w} className="flex gap-3 text-body">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
          <aside {...reveal(1)} className="self-start rounded-2xl border border-brand/30 bg-panel p-6 shadow-card ring-2 ring-brand/10">
            <h2 className="text-heading">{c.priceTitle}</h2>
            <p className="mt-2 text-body text-muted">{c.priceBody}</p>
            <p className="mt-3 text-caption text-muted">{all.plans.taxes.split('.')[0]}.</p>
            <Link href={`/${params.lang}/contact/?kind=SALES`} className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand text-body-strong text-brand-contrast hover:bg-brand-hover">
              {c.cta}
            </Link>
            <Link href={`/${params.lang}/plans/`} className="mt-3 block text-center text-small font-semibold text-brand-text hover:underline">
              {all.nav.plans}
            </Link>
          </aside>
        </div>
        <p className="mt-10 max-w-3xl text-caption text-muted">
          {c.privacy}{' '}
          <Link href={`/${params.lang}/privacy/`} className="underline">{all.footer.privacy}</Link>
        </p>
      </Section>
    </>
  );
}
