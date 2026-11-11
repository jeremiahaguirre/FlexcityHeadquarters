import { ArrowRight, Check, ChevronDown, Minus } from 'lucide-react';
import Link from 'next/link';
import { PageHero } from '@/components/PageHero';
import { BrandShapes, DeviceDuo, ShowRow } from '@/components/Device';
import { captions } from '@/content/screens';
import { Icon } from '@/components/Icon';
import { Kicker, Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { cn } from '@/lib/cn';
import { reveal } from '@/lib/reveal';
import { pageMeta } from '@/lib/seo';
import { GROUPS, ITEMS, type Item, LEVELS, PRIVATE, PUBLIC, TERM_DISCOUNTS, UPFRONT_BONUS, YEARLY_DISCOUNT, has, yearlyMonthly } from '@/content/pricing';
import { PeriodToggle } from '@/components/PeriodToggle';
import { RenewalNote, RenewalTerms } from '@/components/RenewalNote';
import { btnPrimary, btnSecondary } from '@/lib/buttons';

const Yes = ({ label }: { label: string }) => (
  <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-ok-bg text-ok">
    <Check className="h-4 w-4" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>
);
const No = ({ label }: { label: string }) => (
  <span className="text-line">
    <Minus className="mx-auto h-4 w-4" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>
);

/** Plans and prices (EN/FR), from content/pricing.ts: public-sector plans by size, the private-sector price, and what each option includes. */
export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).plans;
  return pageMeta(params.lang, 'plans/', c.title, c.metaDescription);
}

export default async function Plans(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).plans;
  const quote = `/${params.lang}/contact/?kind=SALES`;
  const money = (n: number) => new Intl.NumberFormat(params.lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
  const btn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-2 text-center text-body-strong';
  const btnBrand = cn(btn, 'bg-brand text-brand-contrast shadow-lift hover:bg-brand-hover');
  const btnLine = cn(btn, 'border border-line bg-panel hover:bg-surface');
  const btnLight = cn(btn, 'bg-[#C5F23A] text-[#14210A] hover:bg-[#D4F767]');
  // Billing answers as structured data, like the FAQ page.
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faq.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      {/* Header: a short title, the rest in the lead, and a drawing of the Billing page with sample data */}
      <PageHero eyebrow={c.title} title={c.hero} lead={c.lead} aside={<div className="relative"><BrandShapes className="absolute -inset-x-[10%] -inset-y-[12%] h-[124%] w-[120%]" /><div className="duo-in relative"><PlanMock lang={params.lang} /></div></div>}>
        <ul className="mt-6 flex flex-wrap gap-2">
          {c.chips.map((chip) => (
            <li key={chip} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-1.5 text-small font-semibold">
              <Check className="h-4 w-4 text-ok" aria-hidden="true" />
              {chip}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href={quote} className={btnPrimary}>
            {c.cta}
            <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
          </Link>
          <a href="#included" className={btnSecondary}>{c.jump}</a>
        </div>
        <p className="mt-4 text-caption text-muted">{c.ctaNote}</p>
        <RenewalNote lang={params.lang} className="mt-1 max-w-2xl" />
      </PageHero>

      {/* Public-sector plans */}
      <Section>
        <SectionHead n="01" eyebrow={c.plansKicker} title={c.publicTitle} lead={c.publicLead} />
        <PeriodToggle target="plan-cards" label={c.periodLabel} monthly={c.monthly} yearly={c.yearly} save={c.save.replace('{n}', String(YEARLY_DISCOUNT))} />
        <div id="plan-cards" data-period="month" className="group/period grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {LEVELS.map((key, i) => {
            const t = c.levels[i]!;
            const p = PUBLIC[key];
            return (
              <article key={key} {...reveal(i)} className="relative flex flex-col rounded-3xl border border-line bg-panel p-7 shadow-card xl:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-heading">{t.name}</h3>
                  {p.quoted ? <span className="rounded-full bg-new-bg px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-new">{c.quoted}</span> : null}
                </div>
                <p className="mt-2 min-h-[3rem] text-small leading-6 text-muted">{t.desc}</p>
                <p className="mt-5 text-label uppercase tracking-[0.14em] text-muted">{p.quoted ? c.from : '\u00a0'}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-[2.75rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums group-data-[period=year]/period:hidden">{money(p.price)}</span>
                  <span className="hidden font-display text-[2.75rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums group-data-[period=year]/period:inline">{money(yearlyMonthly(p.price))}</span>
                  <span className="text-small text-muted">{c.perFacility}</span>
                </p>
                <p className="mt-1 min-h-[1.25rem] text-caption text-muted">
                  <span className="group-data-[period=year]/period:hidden">{c.billedMonthly}</span>
                  <span className="hidden group-data-[period=year]/period:inline">{c.billedYearly.replace('{price}', money(yearlyMonthly(p.price) * 12))}</span>
                </p>
                <p className="mt-4 text-small font-semibold">{p.staff === null ? c.staffUnlimited : c.staffIncluded.replace('{n}', String(p.staff))}</p>
                <p className="text-caption text-muted">{p.staff === null ? c.noExtra : c.extraStaff.replace('{price}', money(p.extraStaff))}</p>
                <ul className="mt-6 grid gap-3 border-t border-line pt-5 text-small">
                  {t.highlights.map((h) => (
                    <li key={h} className="flex gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                      {h}
                    </li>
                  ))}
                </ul>
                {/* Footer pinned to the bottom so every button lines up across the row. */}
                <div className="mt-auto pt-8">
                  <Link href={`${quote}&plan=${key}`} className={cn(btnLine, 'w-full whitespace-nowrap px-3')}>
                    {c.cta}
                    <ArrowRight className="nudge h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                  <RenewalNote lang={params.lang} compact className="mt-3 text-center" />
                </div>
              </article>
            );
          })}
        </div>
        <RenewalTerms lang={params.lang} className="mt-6 max-w-4xl leading-6" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel/70 p-6">
            <h3 className="text-subheading">{c.sizeTitle}</h3>
            <p className="mt-2 text-small leading-6 text-muted">{c.sizeBody}</p>
          </div>
          <div className="rounded-2xl border border-line bg-panel/70 p-6">
            <h3 className="text-subheading">{c.staffTitle}</h3>
            <p className="mt-2 text-small leading-6 text-muted">{c.staffBody}</p>
          </div>
        </div>
        <p className="mt-5 text-small text-muted">{c.quotedNote}</p>
        <p className="mt-2 text-small text-muted">{c.termsNote.replace('{five}', String(TERM_DISCOUNTS[60])).replace('{upfront}', String(TERM_DISCOUNTS[60]! + UPFRONT_BONUS))}</p>

        {/* Private sector */}
        <article {...reveal()} className="mt-12 grid gap-8 rounded-3xl border border-line bg-panel p-7 shadow-card md:p-10 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <Kicker n="02">{c.privateKicker}</Kicker>
            <h3 className="text-heading [text-wrap:balance]">{c.privateTitle}</h3>
            <p className="mt-3 max-w-lg text-body text-muted">{c.privateLead}</p>
            <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[3rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">{c.privatePrice}</span>
              <span className="text-small text-muted">{c.perMonth}</span>
            </p>
            <p className="mt-2 text-body-strong">{c.privateIncl}</p>
            <p className="text-body text-muted">{c.privateExtra}</p>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href={quote} className={btnBrand}>
                {c.cta}
                <ArrowRight className="nudge h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href={`/${params.lang}/private-sector/`} className="text-small font-semibold text-brand-text hover:underline">
                {c.privateLink}
              </Link>
            </div>
            <RenewalNote lang={params.lang} className="mt-3" />
          </div>
          <div>
            <h4 className="text-subheading">{c.privateModulesTitle}</h4>
            <p className="mt-1 text-small text-muted">{c.privateModulesLead}</p>
            <div className="mt-4 grid gap-3">
              {GROUPS.map((g) => (
                <div key={g} className="overflow-hidden rounded-2xl border border-line">
                  <p className="bg-surface px-4 py-2 text-label uppercase tracking-[0.12em] text-brand-text">{c.groupNames[g]}</p>
                  <ul className="divide-y divide-line">
                    {c.items.filter((it) => ITEMS[it.key as Item].group === g).map((it) => (
                      <li key={it.key} className="flex items-start justify-between gap-4 px-4 py-2.5">
                        <span className="min-w-0">
                          <span className="block text-small font-semibold">{it.name}</span>
                          <span className="block text-caption text-muted">{it.body}</span>
                        </span>
                        <span className="shrink-0 text-small font-semibold tabular-nums">+{money(ITEMS[it.key as Item].private)}<span className="font-normal text-muted"> {c.perMonth}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </article>
      </Section>

      {/* The core, in every plan */}
      <Section tone="panel" className="overflow-hidden">
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
        <p className="mt-8 max-w-3xl text-small leading-6 text-muted">{c.alertsNote}</p>
        <div className="mt-16 md:mt-24">
          <ShowRow flip title={captions(params.lang).plansTitle} body={captions(params.lang).plansBody} visual={<DeviceDuo laptop="laptop-coverage" phone="phone-pay" lang={params.lang} />} />
        </div>
      </Section>

      {/* Comparison: a real table, scrolling sideways on phones */}
      <Section id="included">
        <SectionHead n="04" eyebrow={c.compareKicker} title={c.compareTitle} lead={c.compareLead} />
        <div role="region" aria-label={c.compareTitle} tabIndex={0} className="relative overflow-x-auto rounded-3xl border border-line bg-panel shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <table className="w-full min-w-[46rem] border-collapse text-left text-small">
            <caption className="sr-only">{c.compareTitle}</caption>
            <thead>
              <tr className="bg-surface">
                <th scope="col" className="px-6 py-5 text-small font-semibold text-muted">{c.compareFeature}</th>
                {c.compareCols.map((col, i) => (
                  <th key={col} scope="col" className={cn('w-[13%] px-3 py-5 text-center align-bottom text-body-strong', i === 4 && 'border-l border-line')}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <th scope="row" className="px-6 py-3.5 font-medium">
                  {c.priceRow}
                  <span className="block text-caption font-normal text-muted">{c.perStandardFacility}</span>
                </th>
                {LEVELS.map((l) => <td key={l} className="px-3 py-3.5 text-center font-semibold tabular-nums">{PUBLIC[l].quoted ? `${c.from} ` : ''}{money(PUBLIC[l].price)}</td>)}
                <td className="border-l border-line px-3 py-3.5 text-center font-semibold tabular-nums">
                  {money(PRIVATE.core)}
                  <span className="block text-caption font-normal text-muted">{c.perOrganization}</span>
                </td>
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="px-6 py-3.5 font-medium">
                  {c.staffRow}
                  <span className="block text-caption font-normal text-muted">{c.perStandardFacility}</span>
                </th>
                {LEVELS.map((l) => <td key={l} className="px-3 py-3.5 text-center tabular-nums">{PUBLIC[l].staff ?? c.unlimited}</td>)}
                <td className="border-l border-line px-3 py-3.5 text-center tabular-nums">
                  {PRIVATE.includedUsers}
                  <span className="block text-caption text-muted">{c.perOrganization}</span>
                </td>
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="px-6 py-3.5 font-medium">{c.extraRow}</th>
                {LEVELS.map((l) => <td key={l} className="px-3 py-3.5 text-center tabular-nums">{PUBLIC[l].staff === null ? '—' : money(PUBLIC[l].extraStaff)}</td>)}
                <td className="border-l border-line px-3 py-3.5 text-center tabular-nums">{money(PRIVATE.perUser)}</td>
              </tr>
            </tbody>
            {c.compare.map((g) => (
              <tbody key={g.name}>
                <tr>
                  <th scope="colgroup" colSpan={6} className="border-t border-line bg-page/70 px-6 py-3 text-label uppercase tracking-[0.12em] text-brand-text">{g.name}</th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.f} className="border-t border-line hover:bg-surface/50">
                    <th scope="row" className="px-6 py-3.5 font-medium text-ink">{r.f}</th>
                    {LEVELS.map((l) => <td key={l} className="px-3 py-3.5 text-center"><Yes label={c.included} /></td>)}
                    <td className="border-l border-line px-3 py-3.5 text-center"><Yes label={c.privateCore} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
            {GROUPS.map((g) => (
              <tbody key={g}>
                <tr>
                  <th scope="colgroup" colSpan={6} className="border-t border-line bg-page/70 px-6 py-3 text-label uppercase tracking-[0.12em] text-brand-text">{c.groupNames[g]}</th>
                </tr>
                {c.items.filter((it) => ITEMS[it.key as Item].group === g).map((it) => {
                  const k = it.key as Item;
                  return (
                    <tr key={k} className="border-t border-line hover:bg-surface/50">
                      <th scope="row" className="px-6 py-3.5 font-medium text-ink">{it.name}</th>
                      {LEVELS.map((l) => (
                        <td key={l} className="px-3 py-3.5 text-center">
                          {has(l, k) ? <Yes label={c.included} /> : <span className="text-caption font-semibold tabular-nums text-muted">{c.addFor.replace('{price}', money(ITEMS[k].public))}</span>}
                        </td>
                      ))}
                      <td className="border-l border-line px-3 py-3.5 text-center"><span className="text-caption font-semibold tabular-nums">+{money(ITEMS[k].private)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            <tbody>
              <tr>
                <th scope="colgroup" colSpan={6} className="border-t border-line bg-page/70 px-6 py-3 text-label uppercase tracking-[0.12em] text-brand-text">{c.serviceTitle}</th>
              </tr>
              {c.service.map((r) => (
                <tr key={r.f} className="border-t border-line hover:bg-surface/50">
                  <th scope="row" className="px-6 py-3.5 font-medium text-ink">{r.f}</th>
                  {r.on.map((on, i) => (
                    <td key={i} className={cn('px-3 py-3.5 text-center', i === 4 && 'border-l border-line')}>{on ? <Yes label={c.included} /> : <No label={c.notIncluded} />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Billing and payment */}
      <Section id="billing" tone="panel">
        <SectionHead n="05" eyebrow={c.billingKicker} title={c.billingTitle} lead={c.billingLead} />
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

        <div {...reveal()} className="tint mt-12 grid gap-10 rounded-3xl border border-brand/25 p-7 md:p-10 lg:grid-cols-[1fr_1.1fr]">
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
            <Kicker n="06">{c.billingKicker}</Kicker>
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
            <RenewalNote lang={params.lang} dark className="mt-2 max-w-sm" />
          </div>
        </div>
      </Section>
    </>
  );
}

/** The Billing page, drawn with sample data in the visitor's colour scheme (a picture, not a control). */
function PlanMock({ lang }: { lang: Lang }) {
  const c = copy(lang).plans;
  const m = c.planMock;
  const p = PUBLIC.BUSINESS;
  const money = (n: number) => new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
  const staff = p.staff ?? 0;
  const active = Math.round(staff * 0.7);
  const options = c.items.filter((it) => p.items.includes(it.key as Item)).slice(0, 4);
  return (
    <figure className="mx-auto w-full max-w-md">
      <div role="img" aria-label={m.label} className="select-none rounded-3xl border border-line bg-panel p-5 shadow-card sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-heading">{m.title}</p>
          <span className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-caption font-semibold text-muted">{m.sample}</span>
        </div>
        <p className="mt-2 text-body-strong">{m.plan}</p>
        <p className="mt-1 text-small text-muted">{m.price.replace('{price}', money(p.price)).replace('{n}', String(staff))}</p>
        <p className="mt-4 rounded-xl border border-line px-3.5 py-2.5 text-small font-semibold">{m.period}</p>
        <div className="mt-3 rounded-xl bg-surface p-4">
          <p className="text-caption font-semibold text-muted">{m.staffTitle}</p>
          <p className="mt-1 text-small font-semibold tabular-nums">{m.staffLine.replace('{active}', String(active)).replace('{n}', String(staff))}</p>
          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round((100 * active) / Math.max(1, staff))}%` }} />
          </span>
          <p className="mt-2 text-caption text-muted">{m.staffHelp}</p>
        </div>
        <p className="mt-4 text-caption font-semibold text-muted">{m.optionsTitle}</p>
        <ul className="mt-2 grid gap-1.5 text-small">
          {options.map((it) => (
            <li key={it.key} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
              {it.name}
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 text-center text-caption text-muted">{c.shotCaption}</figcaption>
    </figure>
  );
}
