import { ArrowRight, Check, MapPin } from 'lucide-react';
import Link from 'next/link';
import { PhoneClip } from '@/components/PhoneClip';
import { PageHero } from '@/components/PageHero';
import { Icon } from '@/components/Icon';
import { reveal } from '@/lib/reveal';
import { DepartmentTabs } from '@/components/DepartmentTabs';
import { BoardMock, LoneMock, PayrollMock, SlideMock } from '@/components/Mock';
import { Kicker, Section, SectionHead } from '@/components/Section';
import { cn } from '@/lib/cn';
import { type Lang, copy } from '@/content/copy';
import { pageMeta } from '@/lib/seo';
import { demoLink } from '@/lib/site';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const h = copy(params.lang).home;
  return pageMeta(params.lang, 'product/', h.pages.productTitle, h.pages.productMeta);
}

/** The product in depth: departments, a day in a city, working alone, features, people review. */
export default async function Product(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang);
  const h = c.home;
  const fr = params.lang === 'fr';
  const clock = (t: string) => { const x = /^(\d+:\d+)\s+(.+)$/.exec(t); return x ? [x[1], x[2]] : [t, '']; };
  const k = h.kickers;
  const m = h.mock;
  const dayVisuals = [<SlideMock key="a" m={m} />, <LoneMock key="b" m={m} />, <BoardMock key="c" m={m} />, <PayrollMock key="d" m={m} />];
  const btnLight = 'inline-flex h-12 items-center gap-2 rounded-xl bg-[#C5F23A] px-6 text-body-strong text-[#14210A] shadow-[0_10px_30px_-8px_rgb(197_242_58/0.55)] hover:bg-[#D4F767]';
  const btnGhost = 'inline-flex h-12 items-center rounded-xl border border-white/30 bg-white/5 px-6 text-body-strong text-white hover:bg-white/15';
  return (
    <>
      <PageHero eyebrow={c.nav.product} title={h.pages.productTitle} lead={h.pages.productLead} aside={<PhoneClip clip="count" lang={params.lang} label={h.see.clips[1]!.title} />}>
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
      {/* 01 Departments */}
      <Section id="product" className="wash">
        <SectionHead n="01" eyebrow={k.departments} title={h.departmentsTitle} lead={h.departmentsLead} />
        <DepartmentTabs items={h.departments} label={h.departmentsTitle} />
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

      {/* 02 A day in a city: four moments down a rail that fills as you scroll */}
      <Section tone="panel">
        <SectionHead n="02" eyebrow={k.day} title={h.day.title} lead={h.day.lead} />
        <div className="relative">
          <div aria-hidden="true" className="absolute bottom-2 left-[0.6875rem] top-2 w-0.5 rounded-full bg-line md:left-[1.1875rem]">
            <span className="rail-fill block h-full w-full rounded-full bg-[linear-gradient(180deg,rgb(var(--brand)),rgb(var(--chartreuse)))]" />
          </div>
        <ol className="relative grid gap-14 md:gap-24">
          {h.day.steps.map((s, i) => (
            <li key={s.time} className="relative grid items-center gap-7 pl-10 md:pl-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
              <span aria-hidden="true" className="absolute left-0 top-3 grid h-6 w-6 place-items-center rounded-full border-2 border-brand bg-panel md:left-2">
                <span className="h-2 w-2 rounded-full bg-brand" />
              </span>
              <div {...reveal()}>
                <p className="numeral text-brand-text">
                  {clock(s.time)[0]}
                  {clock(s.time)[1] ? <span className="ml-2 text-[0.3em] font-bold uppercase tracking-normal text-muted">{clock(s.time)[1]}</span> : null}
                </p>
                <p className="mt-4 text-label uppercase tracking-[0.14em] text-muted">{s.who}</p>
                <h3 className="mt-2 text-[1.5rem] font-extrabold leading-8 tracking-[-0.02em] md:text-[1.875rem] md:leading-10 [text-wrap:balance]">{s.title}</h3>
                <p className="mt-3 max-w-xl text-[1.0625rem] leading-7 text-muted">{s.body}</p>
              </div>
              <div {...reveal(1)} aria-hidden="true" className="night night-flat grain overflow-hidden rounded-3xl p-4 shadow-lift sm:p-8">
                <div className="mx-auto max-w-sm">{dayVisuals[i]}</div>
              </div>
            </li>
          ))}
        </ol>
        </div>
      </Section>

      {/* 03 Working alone: the new safety feature for city crews */}
      <Section id="working-alone" tone="night">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div {...reveal()}>
            <div className="flex flex-wrap items-center gap-x-4">
              <Kicker n="03" dark>{k.safety}</Kicker>
              <span className="mb-4 rounded-full bg-[#C5F23A] px-2.5 py-0.5 text-caption font-bold text-[#14210A]">{h.alone.badge}</span>
            </div>
            <h2 className="text-hero2 [text-wrap:balance]">{h.alone.title}</h2>
            <p className="mt-5 max-w-xl text-[1.125rem] leading-8 text-white/85">{h.alone.lead}</p>
            <p className="mt-7 text-label uppercase tracking-[0.14em] text-white/70">{h.alone.placesTitle}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {h.alone.places.map((pl) => (
                <li key={pl} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-small font-semibold text-white">
                  <MapPin className="h-4 w-4 text-[#5EEAD4]" aria-hidden="true" />
                  {pl}
                </li>
              ))}
            </ul>
            <p className="mt-7 inline-flex items-center gap-2 text-small font-semibold text-[#C5F23A]">
              <Check className="h-4 w-4" aria-hidden="true" />
              {h.alone.included}
            </p>
          </div>
          <div {...reveal(1)} className="relative">
            <div aria-hidden="true" className="mx-auto mb-6 max-w-sm lg:mb-8">
              <LoneMock m={m} className="bob" />
            </div>
            <ol className="grid gap-3 sm:grid-cols-2">
              {h.alone.steps.map((st, i) => (
                <li key={st.title} className="glass rounded-2xl p-5">
                  <span aria-hidden="true" className="kicker-num text-caption font-bold text-[#5EEAD4]">0{i + 1}</span>
                  <h3 className="mt-1.5 text-subheading text-white">{st.title}</h3>
                  <p className="mt-1.5 text-small leading-6 text-white/80">{st.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <p className="mt-10 max-w-3xl border-t border-white/15 pt-6 text-caption text-white/70">{h.alone.note}</p>
      </Section>

      {/* 04 Features */}
      <Section className="wash">
        <SectionHead n="04" eyebrow={k.features} title={h.featuresTitle} lead={h.featuresLead} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {h.features.map((f, i) => (
            <article key={f.title} {...reveal(i)} className={cn('lift group relative overflow-hidden rounded-3xl border border-line bg-panel p-7 shadow-card', i === 0 && 'card-glow border-transparent')}>
              <span aria-hidden="true" className="kicker-num absolute right-6 top-6 text-caption font-bold text-muted/70">{String(i + 1).padStart(2, '0')}</span>
              <span className="lift-icon grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-text">
                <Icon name={f.icon} />
              </span>
              <h3 className="mt-5 text-heading">{f.title}</h3>
              <p className="mt-2 text-small leading-6 text-muted">{f.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="relative mx-auto grid max-w-md grid-cols-2 gap-4 lg:max-w-none" {...reveal()}>
            <div aria-hidden="true" className="absolute inset-6 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.25),transparent)] blur-2xl" />
            <img src={`/screens/phone-headcount${fr ? '-fr' : ''}.png`} alt={h.screensAlt[0]} className="rounded-[1.5rem] border-[5px] border-[#0B1F22] shadow-lift" width={390} height={844} loading="lazy" />
            <img src={`/screens/phone-board${fr ? '-fr' : ''}.png`} alt={h.screensAlt[1]} className="mt-10 rounded-[1.5rem] border-[5px] border-[#0B1F22] shadow-lift" width={390} height={844} loading="lazy" />
          </div>
          <div {...reveal(1)}>
            <p className="mb-3 text-label uppercase tracking-[0.14em] text-brand-text">{h.screensTitle}</p>
            <h2 className="mb-7 text-title [text-wrap:balance]">{h.rolesTitle}</h2>
            <ul className="grid gap-0 divide-y divide-line border-y border-line">
              {h.roles.map((r) => (
                <li key={r.who} className="grid gap-1 py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
                  <span className="text-body-strong">{r.who}</span>
                  <span className="text-small leading-6 text-muted">{r.what}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* 05 People review: the HR differentiator */}
      <Section id="people-review" tone="panel" className="scroll-mt-16 overflow-hidden">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div {...reveal()}>
            <Kicker n="05">{h.peopleEyebrow}</Kicker>
            <h2 className="text-title [text-wrap:balance]">{h.peopleTitle}</h2>
            <p className="mt-4 text-[1.0625rem] leading-7 text-muted">{h.peopleLead}</p>
            <ul className="mt-7 grid gap-5">
              {h.peoplePoints.map((pt) => (
                <li key={pt.title} className="flex gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok-bg text-ok">
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-body-strong">{pt.title}</span>
                    <span className="text-small leading-6 text-muted">{pt.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href={demoLink('HR_ADMIN', params.lang)} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-body-strong text-brand-contrast shadow-lift hover:bg-brand-hover">
                {h.peopleCta}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-4 text-caption text-muted">{h.peopleNote}</p>
          </div>
          <div {...reveal(1)} className="relative">
            <div aria-hidden="true" className="absolute -inset-6 -z-0 rounded-[2.5rem] bg-[linear-gradient(140deg,rgb(var(--brand)/0.22),rgb(var(--chartreuse)/0.22))] blur-xl" />
            <div className="tilt relative overflow-hidden rounded-2xl border border-line bg-panel shadow-lift">
              <img src={`/screens/desktop-casefile${fr ? '-fr' : ''}.png`} alt={fr ? 'Dossier d’un employé : score, signalements motivés et faits datés' : 'An employee’s case file: score, flags with reasons and dated facts'} className="block w-full" width={944} height={640} loading="lazy" />
            </div>
          </div>
        </div>
      </Section>

      <Section tone="brand">
        <div {...reveal()} className="grid items-center gap-8 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-label uppercase tracking-[0.14em] text-white/70">{h.pages.nextLead}</p>
            <h2 className="mt-3 text-hero2 [text-wrap:balance]">{h.ctaTitle}</h2>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Link href={`/${params.lang}/why/`} className={btnLight}>
              {h.pages.nextWhy}
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
