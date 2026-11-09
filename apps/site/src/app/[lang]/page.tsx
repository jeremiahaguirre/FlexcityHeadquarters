import { ArrowRight, Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { CountUp } from '@/components/Motion';
import { reveal } from '@/lib/reveal';
import { Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { SITE_URL, pageMeta } from '@/lib/seo';
import { demoLink } from '@/lib/site';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang);
  return pageMeta(params.lang, '', undefined, c.meta.description);
}

export default function Home({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang);
  const h = c.home;
  const fr = params.lang === 'fr';
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
      offers: { '@type': 'AggregateOffer', priceCurrency: 'CAD', lowPrice: 99, highPrice: 5000, offerCount: 4, url: `${SITE_URL}/${params.lang}/plans/` },
    },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Two soft colour washes that drift slowly (transform only; still when motion is reduced) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="drift absolute -right-[10%] -top-[30%] h-[80%] w-[70%] bg-[radial-gradient(closest-side,rgb(var(--brand)/0.2),transparent)]" />
          <div className="drift drift-slow absolute -bottom-[30%] -left-[15%] h-[70%] w-[55%] bg-[radial-gradient(closest-side,rgb(var(--chartreuse)/0.22),transparent)]" />
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 md:px-6 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
          <div className="rise">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-caption font-semibold text-brand-text">
              <span className="pulse-dot h-2 w-2 rounded-full bg-chartreuse" aria-hidden="true" />
              {h.eyebrow}
            </p>
            <h1 className="text-display [text-wrap:balance]">{h.title}</h1>
            <p className="mt-5 max-w-xl text-[1.0625rem] leading-7 text-muted">{h.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={demoLink('STAFF', params.lang)} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-body-strong text-brand-contrast shadow-lift hover:bg-brand-hover">
                {h.ctaDemo}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </a>
              <Link href={`/${params.lang}/contact/?kind=DEMO`} className="inline-flex h-12 items-center rounded-xl border border-line bg-panel px-6 text-body-strong hover:bg-surface">
                {h.ctaTalk}
              </Link>
            </div>
            <p className="mt-3 text-caption text-muted">{h.fine}</p>
          </div>
          {/* Product shots: desktop with a phone in front */}
          <div className="rise rise-2 relative mx-auto w-full max-w-xl lg:max-w-none">
            <div className="tilt overflow-hidden rounded-2xl border border-line bg-panel shadow-lift">
              <img src={`/screens/desktop-schedule${fr ? '-fr' : ''}.png`} alt={fr ? 'Préparation de l’horaire de la semaine' : 'Building the week’s schedule'} className="block w-full" width={1280} height={800} />
            </div>
            <div className="float absolute -bottom-10 -left-4 w-[36%] max-w-[13rem] overflow-hidden rounded-[1.75rem] border-[6px] border-[#0B1F22] bg-panel shadow-lift sm:-left-8">
              <img src={`/screens/phone-today${fr ? '-fr' : ''}.png`} alt={fr ? 'Pointer d’un glissement sur téléphone' : 'Slide to clock in on a phone'} className="block w-full" width={390} height={844} />
            </div>
          </div>
        </div>
      </section>

      {/* Proof points */}
      <Section tone="panel" className="!py-0">
        <h2 className="sr-only">{h.proofTitle}</h2>
        <dl className="grid grid-cols-2 gap-6 py-10 md:grid-cols-4">
          {h.proof.map((p, i) => (
            <div key={p.v} {...reveal(i)}>
              <dt className="sr-only">{p.v}</dt>
              <dd className="font-display text-stat text-brand-text">
                <CountUp value={p.k} />
              </dd>
              <dd className="mt-1 text-small text-muted">{p.v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* Departments */}
      <Section id="product">
        <SectionHead title={h.departmentsTitle} lead={h.departmentsLead} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {h.departments.map((d, i) => (
            <article key={d.title} {...reveal(i)} className="lift flex gap-4 rounded-2xl border border-line bg-panel p-6 shadow-card">
              <span className="lift-icon grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand-text">
                <Icon name={d.icon} />
              </span>
              <span>
                <h3 className="text-subheading">{d.title}</h3>
                <p className="mt-1.5 text-small leading-6 text-muted">{d.body}</p>
              </span>
            </article>
          ))}
        </div>
        <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-body">
          <a href={demoLink('EMPLOYEE', params.lang)} className="inline-flex items-center gap-1.5 font-semibold text-brand-text hover:underline">
            {fr ? 'Essayer la démo comme opérateur de l’eau potable' : 'Try the demo as a water works operator'}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </a>
          <a href={demoLink('STAFF', params.lang)} className="inline-flex items-center gap-1.5 font-semibold text-brand-text hover:underline">
            {fr ? 'ou comme sauveteur' : 'or as a lifeguard'}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </a>
        </p>
      </Section>

      {/* Features */}
      <Section tone="panel">
        <SectionHead title={h.featuresTitle} lead={h.featuresLead} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {h.features.map((f, i) => (
            <article key={f.title} {...reveal(i)} className="lift rounded-2xl border border-line bg-panel p-6 shadow-card">
              <span className="lift-icon grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-text">
                <Icon name={f.icon} />
              </span>
              <h3 className="mt-4 text-heading">{f.title}</h3>
              <p className="mt-2 text-small leading-6 text-muted">{f.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-14 grid items-center gap-10 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-4" {...reveal()}>
            <img src={`/screens/phone-headcount${fr ? '-fr' : ''}.png`} alt={fr ? 'Compteur de baigneurs' : 'Bather headcount clicker'} className="rounded-[1.5rem] border-[5px] border-[#0B1F22] shadow-lift" width={390} height={844} />
            <img src={`/screens/phone-board${fr ? '-fr' : ''}.png`} alt={fr ? 'Babillard des quarts' : 'Shift board'} className="mt-10 rounded-[1.5rem] border-[5px] border-[#0B1F22] shadow-lift" width={390} height={844} />
          </div>
          <div {...reveal(1)}>
            <SectionHead title={h.rolesTitle} />
            <ul className="grid gap-4">
              {h.roles.map((r) => (
                <li key={r.who} className="flex gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
                  <span>
                    <span className="block text-body-strong">{r.who}</span>
                    <span className="text-small text-muted">{r.what}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* People review: the HR differentiator */}
      <Section id="people-review" className="scroll-mt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
          <div {...reveal()}>
            <p className="mb-3 inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-caption font-semibold text-accent">{h.peopleEyebrow}</p>
            <h2 className="text-title [text-wrap:balance]">{h.peopleTitle}</h2>
            <p className="mt-3 text-body leading-7 text-muted">{h.peopleLead}</p>
            <ul className="mt-6 grid gap-4">
              {h.peoplePoints.map((pt) => (
                <li key={pt.title} className="flex gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
                  <span>
                    <span className="block text-body-strong">{pt.title}</span>
                    <span className="text-small leading-6 text-muted">{pt.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <a href={demoLink('HR_ADMIN', params.lang)} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-body-strong text-brand-contrast hover:bg-brand-hover">
                {h.peopleCta}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-4 text-caption text-muted">{h.peopleNote}</p>
          </div>
          <div {...reveal(1)} className="overflow-hidden rounded-2xl border border-line bg-panel shadow-lift">
            <img src={`/screens/desktop-casefile${fr ? '-fr' : ''}.png`} alt={fr ? 'Dossier d’un employé : score, signalements motivés et faits datés' : 'An employee’s case file: score, flags with reasons and dated facts'} className="block w-full" width={944} height={640} loading="lazy" />
          </div>
        </div>
      </Section>

      {/* Why FH is different: compared with today's workarounds, never with named products */}
      <Section id="why" className="scroll-mt-16">
        <SectionHead title={h.whyTitle} lead={h.whyLead} />
        <div {...reveal()} className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
          <div className="hidden grid-cols-[1.1fr_1fr_1.4fr] gap-6 border-b border-line bg-surface px-6 py-3 text-label uppercase text-muted md:grid">
            <span />
            <span>{h.whyThem}</span>
            <span className="text-brand-text">{h.whyUs}</span>
          </div>
          <ul className="divide-y divide-line">
            {h.why.map((w) => (
              <li key={w.title} className="grid gap-3 px-6 py-5 md:grid-cols-[1.1fr_1fr_1.4fr] md:gap-6">
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

      {/* Private sector */}
      <Section tone="panel">
        <div {...reveal()} className="grid items-center gap-6 rounded-3xl border border-brand/20 bg-brand/5 p-8 md:grid-cols-[1.6fr_auto] md:p-10">
          <div>
            <h2 className="text-title [text-wrap:balance]">{h.privateTitle}</h2>
            <p className="mt-3 max-w-2xl text-body text-muted">{h.privateBody}</p>
          </div>
          <Link href={`/${params.lang}/private-sector/`} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-brand/30 bg-panel px-6 text-body-strong text-brand-text hover:bg-surface">
            {h.privateCta}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </Section>

      {/* Trust */}
      <Section>
        <SectionHead title={h.trustTitle} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {h.trust.map((t, i) => (
            <div key={t.title} {...reveal(i)} className="rounded-2xl bg-surface p-6">
              <h3 className="text-subheading">{t.title}</h3>
              <p className="mt-2 text-small leading-6 text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Closing CTA */}
      <Section tone="brand">
        <div {...reveal()} className="grid items-center gap-8 md:grid-cols-[1.4fr_1fr]">
          <div>
            <span className="float mb-5 inline-grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-lift">
              <LogoMark size={44} />
            </span>
            <h2 className="text-title text-white [text-wrap:balance]">{h.ctaTitle}</h2>
            <p className="mt-3 max-w-xl text-white/80">{h.ctaBody}</p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <a href={demoLink('STAFF', params.lang)} className="inline-flex h-12 items-center rounded-xl bg-white px-6 text-body-strong text-[#0B3B3C] hover:bg-white/90">
              {h.ctaDemo}
            </a>
            <Link href={`/${params.lang}/contact/?kind=DEMO`} className="inline-flex h-12 items-center rounded-xl border border-white/40 px-6 text-body-strong text-white hover:bg-white/10">
              {h.ctaTalk}
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
