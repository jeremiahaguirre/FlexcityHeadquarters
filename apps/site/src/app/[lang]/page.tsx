import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { CountUp } from '@/components/Motion';
import { reveal } from '@/lib/reveal';
import { AppClips } from '@/components/AppClips';
import { HeroConsole } from '@/components/Mock';
import { Kicker, Section, SectionHead } from '@/components/Section';
import { cn } from '@/lib/cn';
import { type Lang, copy } from '@/content/copy';
import { SITE_URL, pageMeta } from '@/lib/seo';
import { demoLink } from '@/lib/site';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang);
  return pageMeta(params.lang, '', undefined, c.meta.description);
}

export default async function Home(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang);
  const h = c.home;
  const m = h.mock;
  const btnLight = 'inline-flex h-12 items-center gap-2 rounded-xl bg-[#C5F23A] px-6 text-body-strong text-[#14210A] shadow-[0_10px_30px_-8px_rgb(197_242_58/0.55)] hover:bg-[#D4F767]';
  const btnGhost = 'inline-flex h-12 items-center rounded-xl border border-white/30 bg-white/5 px-6 text-body-strong text-white hover:bg-white/15';
  // Structured data: who we are and what we sell (no ratings or reviews we don't have).
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'FlexcityHeadquarters', url: SITE_URL, logo: `${SITE_URL}/logo.png`, areaServed: 'CA' },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'FlexcityHeadquarters',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android, Windows, macOS',
      description: c.meta.description,
      inLanguage: ['en-CA', 'fr-CA'],
      url: `${SITE_URL}/${params.lang}/`,
      offers: { '@type': 'AggregateOffer', priceCurrency: 'CAD', lowPrice: 99, highPrice: 4500, offerCount: 5, url: `${SITE_URL}/${params.lang}/plans/` },
    },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      {/* Hero: always dark, the statement across the full width, the product picture beside the pitch */}
      <section className="night grain overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-12 md:px-6 md:pb-20 md:pt-20">
          <div className="rise">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-caption font-semibold text-white">
              <span className="pulse-dot h-2 w-2 rounded-full bg-[#C5F23A]" aria-hidden="true" />
              {h.eyebrow}
            </p>
            <h1 className="text-mega">
              {h.titleLines.map((line, i) => (
                <span key={line} className={cn('block [text-wrap:balance]', i === h.titleLines.length - 1 && 'text-dawn pb-2')}>
                  {line}{' '}
                </span>
              ))}
            </h1>
          </div>
          <div className="mt-10 grid items-start gap-14 lg:mt-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div className="rise rise-2">
              <p className="max-w-xl text-[1.125rem] leading-8 text-white/85">{h.lead}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={demoLink('STAFF', params.lang)} className={btnLight}>
                  {h.ctaDemo}
                  <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
                </a>
                <Link href={`/${params.lang}/contact/?kind=DEMO`} className={btnGhost}>
                  {h.ctaTalk}
                </Link>
              </div>
              <p className="mt-4 text-caption text-white/70">{h.fine}</p>
              <h2 className="sr-only">{h.proofTitle}</h2>
              <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-7 border-t border-white/15 pt-8">
                {h.proof.map((p) => (
                  <div key={p.v}>
                    <dt className="sr-only">{p.v}</dt>
                    <dd className="text-dawn font-display text-stat">
                      <CountUp value={p.k} />
                    </dd>
                    <dd className="mt-1 text-small text-white/75">{p.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rise rise-2 sm:pt-24 lg:pt-20">
              <HeroConsole m={m} />
            </div>
          </div>
        </div>
      </section>

      {/* 01 See it work: real recordings of the app, light or dark */}
      <Section id="see" className="wash">
        <SectionHead n="01" eyebrow={h.see.kicker} title={h.see.title} lead={h.see.lead} />
        <AppClips clips={h.see.clips} lang={params.lang} labels={h.see} />
      </Section>

      {/* 02 Every department, in brief, then the product page */}
      <Section tone="panel">
        <div className="grid items-end gap-6 md:grid-cols-[1.4fr_auto]">
          <SectionHead n="02" eyebrow={h.teaser.productKicker} title={h.teaser.productTitle} lead={h.teaser.productLead} />
          <Link href={`/${params.lang}/product/`} className="mb-10 inline-flex h-12 items-center gap-2 justify-self-start rounded-xl bg-brand px-6 text-body-strong text-brand-contrast shadow-lift hover:bg-brand-hover md:mb-14">
            {h.teaser.productLink}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {h.departments.slice(0, 4).map((d, i) => (
            <li key={d.title} {...reveal(i)}>
              <Link href={`/${params.lang}/product/#product`} className="lift group flex h-full flex-col rounded-3xl border border-line bg-page/60 p-6 hover:border-brand/40">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/10 text-brand-text"><Icon name={d.icon} /></span>
                <h3 className="mt-4 text-subheading">{d.title}</h3>
                <p className="mt-1.5 line-clamp-3 text-small leading-6 text-muted">{d.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* 03 Why FH, in brief, then the why page */}
      <Section>
        <div className="grid items-end gap-6 md:grid-cols-[1.4fr_auto]">
          <SectionHead n="03" eyebrow={h.teaser.whyKicker} title={h.teaser.whyTitle} />
          <Link href={`/${params.lang}/why/`} className="mb-10 inline-flex h-12 items-center gap-2 justify-self-start rounded-xl border border-line bg-panel px-6 text-body-strong hover:bg-surface md:mb-14">
            {h.teaser.whyLink}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {h.why.slice(0, 3).map((w, i) => (
            <li key={w.title} {...reveal(i)} className="rounded-3xl border border-line bg-panel p-7 shadow-card">
              <span aria-hidden="true" className="mb-5 block h-1 w-10 rounded-full bg-[linear-gradient(90deg,rgb(var(--brand)),rgb(var(--chartreuse)))]" />
              <h3 className="text-subheading">{w.title}</h3>
              <p className="mt-2 text-small leading-6 text-muted">{w.us}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 04 Plans in one line, private sector in one line */}
      <Section tone="panel">
        <div {...reveal()} className="grid items-center gap-6 rounded-3xl border border-line bg-panel p-8 shadow-card md:grid-cols-[1.6fr_auto] md:p-12">
          <div>
            <Kicker n="04">{c.nav.plans}</Kicker>
            <h2 className="text-[1.75rem] font-extrabold leading-9 tracking-[-0.02em] md:text-[2.25rem] md:leading-[2.75rem] [text-wrap:balance]">{h.teaser.plansTitle}</h2>
            <p className="mt-3 max-w-2xl text-body text-muted">{h.teaser.plansBody}</p>
          </div>
          <div className="flex flex-col gap-3">
            <Link href={`/${params.lang}/plans/`} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-body-strong text-brand-contrast shadow-lift hover:bg-brand-hover">
              {h.teaser.plansLink}
              <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={`/${params.lang}/private-sector/`} className="inline-flex h-12 items-center justify-center rounded-xl border border-line px-6 text-body-strong text-brand-text hover:bg-surface">
              {h.privateCta}
            </Link>
          </div>
        </div>
      </Section>

      {/* Closing CTA */}
      <Section tone="brand">
        <div {...reveal()} className="grid items-center gap-10 md:grid-cols-[1.4fr_1fr]">
          <div>
            <span className="float mb-6 inline-grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-lift">
              <LogoMark size={44} />
            </span>
            <h2 className="text-hero2 [text-wrap:balance]">{h.ctaTitle}</h2>
            <p className="mt-4 max-w-xl text-[1.0625rem] leading-7 text-white/85">{h.ctaBody}</p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <a href={demoLink('STAFF', params.lang)} className={btnLight}>
              {h.ctaDemo}
              <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
            </a>
            <Link href={`/${params.lang}/contact/?kind=DEMO`} className={btnGhost}>
              {h.ctaTalk}
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
