import { ArrowRight, Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { PageHero } from '@/components/PageHero';
import { reveal } from '@/lib/reveal';
import { Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { pageMeta } from '@/lib/seo';
import { demoLink } from '@/lib/site';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const h = copy(params.lang).home;
  return pageMeta(params.lang, 'why/', copy(params.lang).nav.why, h.pages.whyMeta);
}

/** Why cities choose FH: compared with today's workarounds, the trust story, and private employers. */
export default async function Why(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang);
  const h = c.home;
  const k = h.kickers;
  const btnLight = 'inline-flex h-12 items-center gap-2 rounded-xl bg-[#C5F23A] px-6 text-body-strong text-[#14210A] shadow-[0_10px_30px_-8px_rgb(197_242_58/0.55)] hover:bg-[#D4F767]';
  const btnGhost = 'inline-flex h-12 items-center rounded-xl border border-white/30 bg-white/5 px-6 text-body-strong text-white hover:bg-white/15';
  return (
    <>
      <PageHero eyebrow={c.nav.why} title={h.pages.whyTitle} lead={h.pages.whyLead}>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={demoLink('STAFF', params.lang)} className={btnLight}>
            {h.ctaDemo}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </a>
          <Link href={`/${params.lang}/contact/?kind=DEMO`} className={btnGhost}>
            {h.ctaTalk}
          </Link>
        </div>
      </PageHero>
      {/* 06 Why FH is different: compared with today's workarounds, never with named products */}
      <Section id="why" className="scroll-mt-16">
        <SectionHead n="01" eyebrow={k.why} title={h.whyTitle} lead={h.whyLead} />
        <div {...reveal()} className="overflow-hidden rounded-3xl border border-line bg-panel shadow-card">
          <div className="hidden grid-cols-[1.1fr_1fr_1.4fr] gap-6 border-b border-line bg-surface px-7 py-4 text-label uppercase text-muted md:grid">
            <span />
            <span>{h.whyThem}</span>
            <span className="text-brand-text">{h.whyUs}</span>
          </div>
          <ul className="divide-y divide-line">
            {h.why.map((w) => (
              <li key={w.title} className="grid gap-3 px-6 py-5 md:grid-cols-[1.1fr_1fr_1.4fr] md:gap-6 md:px-7">
                <h3 className="text-body-strong">{w.title}</h3>
                <p className="flex gap-2 text-small text-muted">
                  <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="sr-only md:hidden">{h.whyThem}: </span>
                    {w.them}
                  </span>
                </p>
                <p className="flex gap-2 text-small">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                  <span>
                    <span className="sr-only md:hidden">{h.whyUs}: </span>
                    {w.us}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-caption text-muted">{h.whyNote}</p>
          <Link href={`/${params.lang}/contact/?kind=DEMO`} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-body-strong text-brand-contrast hover:bg-brand-hover">
            {h.ctaTalk}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </Section>

      {/* 07 Trust */}
      <Section tone="panel">
        <SectionHead n="02" eyebrow={k.trust} title={h.trustTitle} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {h.trust.map((t, i) => (
            <div key={t.title} {...reveal(i)} className="rounded-3xl border border-line bg-surface/60 p-7">
              <span aria-hidden="true" className="mb-5 block h-1 w-10 rounded-full bg-[linear-gradient(90deg,rgb(var(--brand)),rgb(var(--chartreuse)))]" />
              <h3 className="text-subheading">{t.title}</h3>
              <p className="mt-2 text-small leading-6 text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section tone="brand">
        <div {...reveal()} className="grid items-center gap-8 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-label uppercase tracking-[0.14em] text-white/70">{h.pages.nextLead}</p>
            <h2 className="mt-3 text-hero2 [text-wrap:balance]">{h.ctaTitle}</h2>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Link href={`/${params.lang}/plans/`} className={btnLight}>
              {h.pages.nextPlans}
              <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
            </Link>
            <a href={demoLink('STAFF', params.lang)} className={btnGhost}>
              {h.ctaDemo}
            </a>
          </div>
        </div>
      </Section>
    </>
  );
}
