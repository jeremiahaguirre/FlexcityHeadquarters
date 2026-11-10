import { ArrowRight, Check, ChevronDown, Minus } from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Kicker, Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { cn } from '@/lib/cn';
import { reveal } from '@/lib/reveal';
import { pageMeta } from '@/lib/seo';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).plans;
  return pageMeta(params.lang, 'plans/', c.title, c.lead);
}

export default async function Plans(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).plans;
  const quote = `/${params.lang}/contact/?kind=SALES`;
  const money = (n: number) => new Intl.NumberFormat(params.lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
  const btn = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-body-strong';
  const btnBrand = cn(btn, 'bg-brand text-brand-contrast shadow-lift hover:bg-brand-hover');
  const btnLine = cn(btn, 'border border-line bg-panel hover:bg-surface');
  const btnLight = cn(btn, 'bg-[#C5F23A] text-[#14210A] shadow-[0_10px_30px_-8px_rgb(197_242_58/0.55)] hover:bg-[#D4F767]');
  // Billing answers as structured data, like the FAQ page.
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faq.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      {/* Hero */}
      <section className="night grain overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-12 md:px-6 md:pb-24 md:pt-20">
          <div className="rise max-w-5xl">
            <Kicker dark>{c.title}</Kicker>
            <h1 className="text-hero2 [text-wrap:balance]">{c.hero}</h1>
            <p className="mt-6 max-w-3xl text-[1.125rem] leading-8 text-white/85">{c.lead}</p>
            <ul className="mt-7 flex flex-wrap gap-2">
              {c.chips.map((chip) => (
                <li key={chip} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-small font-semibold text-white">
                  <Check className="h-4 w-4 text-[#C5F23A]" aria-hidden="true" />
                  {chip}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={quote} className={btnLight}>
                {c.cta}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </Link>
              <a href="#included" className={cn(btn, 'border border-white/30 bg-white/5 text-white hover:bg-white/15')}>{c.jump}</a>
            </div>
            <p className="mt-4 text-caption text-white/70">{c.ctaNote}</p>
          </div>
        </div>
      </section>

      {/* Plans */}
      <Section className="wash">
        <SectionHead n="01" eyebrow={c.plansKicker} title={c.municipalTitle} lead={c.municipalLead} />
        <div className="grid gap-5 lg:grid-cols-3">
          {c.tiers.map((t, i) => {
            const featured = 'featured' in t && t.featured;
            return (
              <article key={t.name} {...reveal(i)} className={cn('lift relative flex flex-col rounded-3xl border bg-panel p-7 shadow-card md:p-8', featured ? 'card-glow border-transparent shadow-lift' : 'border-line')}>
                <h3 className="text-heading">{t.name}</h3>
                <p className="mt-2 min-h-[3rem] text-small leading-6 text-muted">{t.desc}</p>
                <p className="mt-6 text-label uppercase tracking-[0.14em] text-muted">{c.startingAt}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-[3rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums md:text-[3.5rem]">{money(t.price)}</span>
                  <span className="text-small text-muted">{c.perFacility}</span>
                </p>
                <ul className="mt-7 grid gap-3 border-t border-line pt-6 text-small">
                  {c.tierIncludes.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
                <Link href={quote} className={cn('mt-8', featured ? btnBrand : btnLine)}>
                  {c.cta}
                  <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
                </Link>
              </article>
            );
          })}
        </div>
        <p className="mt-5 text-small text-muted">{c.municipalNote}</p>

        {/* Private sector */}
        <article {...reveal()} className="mt-12 grid gap-8 rounded-3xl border border-line bg-panel p-7 shadow-card md:p-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <Kicker n="02">{c.privateTitle}</Kicker>
            <p className="max-w-lg text-body text-muted">{c.privateLead}</p>
            <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[3rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums md:text-[3.5rem]">{c.privatePrice}</span>
              <span className="text-small text-muted">{c.perMonth}</span>
            </p>
            <p className="mt-2 text-body-strong">{c.privateIncl}</p>
            <p className="text-body text-muted">{c.privateExtra}</p>
          </div>
          <div>
            <ul className="grid gap-3 text-small">
              {c.privatePoints.map((p) => (
                <li key={p} className="flex gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href={quote} className={btnBrand}>
                {c.cta}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href={`/${params.lang}/private-sector/`} className="text-small font-semibold text-brand-text hover:underline">
                {c.privateLink}
              </Link>
            </div>
          </div>
        </article>
      </Section>

      {/* What every plan includes */}
      <Section id="included" tone="panel">
        <SectionHead n="03" eyebrow={c.baseKicker} title={c.baseTitle} lead={c.baseLead} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.base.map((g, i) => (
            <article key={g.name} {...reveal(i)} className="rounded-3xl border border-line bg-page/60 p-7">
              <h3 className="flex items-center gap-3 text-subheading">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand-text">
                  <Icon name={g.icon} className="h-5 w-5" />
                </span>
                {g.name}
              </h3>
              <ul className="mt-5 grid gap-3 text-small leading-6">
                {g.items.map((it) => (
                  <li key={it.t} className="flex gap-2.5">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                    <span>
                      {it.t}
                      {'isNew' in it && it.isNew ? <span className="ml-2 inline-block rounded-full bg-new-bg px-2 py-0.5 align-middle text-[0.6875rem] font-bold uppercase tracking-wide text-new">{c.newBadge}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      {/* Add-ons */}
      <Section tone="night">
        <SectionHead n="04" eyebrow={c.addOnsKicker} title={c.addOnsTitle} lead={c.addOnsLead} dark />
        <div className="grid gap-5 lg:grid-cols-3">
          {c.addOns.map((a, i) => (
            <article key={a.name} {...reveal(i)} className="glass flex flex-col rounded-3xl p-7 md:p-8">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-[#5EEAD4]">
                <Icon name={a.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-heading text-white">{a.name}</h3>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                <span className="text-dawn font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{a.price}</span>
                <span className="text-small text-white/75">{a.unit}</span>
              </p>
              <p className="mt-4 text-small leading-6 text-white/80">{a.body}</p>
              <ul className="mt-5 grid gap-3 border-t border-white/15 pt-5 text-small text-white/90">
                {a.items.map((it) => (
                  <li key={it} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C5F23A]" aria-hidden="true" />
                    {it}
                  </li>
                ))}
              </ul>
              <Link href={quote} className={cn(btn, 'mt-auto border border-white/30 bg-white/5 text-white hover:bg-white/15')} style={{ marginTop: '2rem' }}>
                {c.cta}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </Section>

      {/* Comparison: a real table on wide screens, a labelled list on phones */}
      <Section>
        <SectionHead n="05" eyebrow={c.compareKicker} title={c.compareTitle} lead={c.compareLead} />
        <div className="hidden overflow-hidden rounded-3xl border border-line bg-panel shadow-card md:block">
          <table className="w-full border-collapse text-left text-small">
            <caption className="sr-only">{c.compareTitle}</caption>
            <thead>
              <tr className="bg-surface">
                <th scope="col" className="px-7 py-5 text-label uppercase text-muted">{c.compareFeature}</th>
                {c.compareCols.map((col, i) => (
                  <th key={col} scope="col" className="w-[15%] px-3 py-5 text-center align-bottom">
                    <span className={cn('block text-body-strong', i === 0 && 'text-brand-text')}>{col}</span>
                    <span className="mt-0.5 block text-caption font-medium text-muted">{c.compareColNotes[i]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {c.compare.map((g) => (
              <tbody key={g.name}>
                <tr>
                  <th scope="colgroup" colSpan={5} className="border-t border-line bg-page/70 px-7 py-3 text-label uppercase tracking-[0.12em] text-brand-text">{g.name}</th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.f} className="border-t border-line hover:bg-surface/50">
                    <th scope="row" className="px-7 py-3.5 font-medium text-ink">{r.f}</th>
                    {c.compareCols.map((col, i) => (
                      <td key={col} className={cn('px-3 py-3.5 text-center', i === 0 && 'bg-brand/[0.04]')}>
                        {r.col === i ? (
                          <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-ok-bg text-ok">
                            <Check className="h-4 w-4" aria-hidden="true" />
                            <span className="sr-only">{c.included}</span>
                          </span>
                        ) : (
                          <span className="text-line">
                            <Minus className="mx-auto h-4 w-4" aria-hidden="true" />
                            <span className="sr-only">{c.notIncluded}</span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div className="grid gap-5 md:hidden">
          {c.compare.map((g) => (
            <section key={g.name} className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
              <h3 className="bg-surface px-5 py-3 text-label uppercase tracking-[0.12em] text-brand-text">{g.name}</h3>
              <ul className="divide-y divide-line">
                {g.rows.map((r) => (
                  <li key={r.f} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <span className="text-small font-medium">{r.f}</span>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[0.75rem] font-bold', r.col === 0 ? 'bg-ok-bg text-ok' : r.col === 3 ? 'bg-surface text-ink' : 'bg-new-bg text-new')}>
                      {c.compareCols[r.col]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>

      {/* Billing and payment */}
      <Section id="billing" tone="panel">
        <SectionHead n="06" eyebrow={c.billingKicker} title={c.billingTitle} lead={c.billingLead} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.billing.map((b, i) => (
            <article key={b.title} {...reveal(i)} className="rounded-3xl border border-line bg-page/60 p-7">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand-text">
                <Icon name={b.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-subheading">{b.title}</h3>
              <p className="mt-2 text-small leading-6 text-muted">{b.body}</p>
            </article>
          ))}
        </div>

        <div {...reveal()} className="mt-12 grid gap-10 rounded-3xl border border-brand/25 bg-[linear-gradient(120deg,rgb(var(--brand)/0.1),rgb(var(--chartreuse)/0.1))] p-7 md:p-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h3 className="text-[1.5rem] font-extrabold leading-8 tracking-[-0.02em] md:text-[1.875rem] md:leading-10">{c.implTitle}</h3>
            <p className="mt-3 text-body text-muted">{c.implBody}</p>
            <p className="mt-7 text-label uppercase tracking-[0.14em] text-muted">{c.implCoversTitle}</p>
            <ul className="mt-3 grid gap-2.5 text-small sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {c.implCovers.map((x) => (
                <li key={x} className="flex gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <dl className="grid content-start gap-3">
            {c.impl.map((i) => (
              <div key={i.who} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-2xl border border-line bg-panel px-6 py-5">
                <dt className="text-small font-medium text-muted">{i.who}</dt>
                <dd className="font-display text-[1.375rem] font-extrabold tracking-[-0.02em] tabular-nums">{i.fee}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-6 text-small text-muted">{c.taxes}</p>
      </Section>

      {/* Billing questions */}
      <Section>
        <div className="grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <div>
            <Kicker n="07">{c.billingKicker}</Kicker>
            <h2 className="text-title [text-wrap:balance]">{c.faqTitle}</h2>
            <Link href={`/${params.lang}/faq/`} className="mt-5 inline-flex items-center gap-1.5 text-body font-semibold text-brand-text hover:underline">
              {copy(params.lang).faq.title}
              <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="divide-y divide-line rounded-3xl border border-line bg-panel shadow-card">
            {c.faq.map((it, i) => (
              <details key={it.q} className="group px-6 py-5" open={i === 0}>
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-body-strong">
                  {it.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="mt-3 text-body leading-7 text-muted">{it.a}</p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      {/* Closing CTA */}
      <Section tone="brand">
        <div {...reveal()} className="grid items-center gap-8 md:grid-cols-[1.5fr_auto]">
          <div>
            <h2 className="text-hero2 [text-wrap:balance]">{c.endTitle}</h2>
            <p className="mt-4 max-w-2xl text-[1.0625rem] leading-7 text-white/85">{c.endBody}</p>
          </div>
          <div>
            <Link href={quote} className={btnLight}>
              {c.cta}
              <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
            </Link>
            <p className="mt-3 text-caption text-white/70">{c.ctaNote}</p>
          </div>
        </div>
      </Section>
    </>
  );
}
