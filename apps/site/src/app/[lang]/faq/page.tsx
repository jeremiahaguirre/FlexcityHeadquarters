import { pageMeta } from '@/lib/seo';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { reveal } from '@/lib/reveal';
import { Section } from '@/components/Section';
import { Icon } from '@/components/Icon';
import { PageHero } from '@/components/PageHero';
import { type Lang, copy } from '@/content/copy';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).faq;
  return pageMeta(params.lang, 'faq/', c.title, c.groups.flatMap((g) => g.items.map((i) => i.q)).slice(0, 4).join(' '));
}

const GROUP_ICON = ['calendar', 'calculator', 'users', 'shield', 'receipt', 'clipboard'];

export default async function Faq(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const all = copy(params.lang);
  // The billing questions shown on the plans page also belong to the last group here (Plans and billing).
  const c = { ...all.faq, groups: all.faq.groups.map((g, i, a) => (i === a.length - 1 ? { ...g, items: [...g.items, ...all.plans.faq] } : g)) };
  // FAQPage structured data helps search engines show answers.
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.groups.flatMap((g) => g.items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } }))) };
  return (
    <>
    <PageHero eyebrow={all.nav.faq} title={c.title} size="md" />
    <Section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={c.title} className="hidden lg:block">
          <ul className="sticky top-24 grid gap-1 text-small">
            {c.groups.map((g, i) => (
              <li key={g.name}>
                <a href={`#g${i}`} className="block rounded-lg px-3 py-2 font-semibold text-muted hover:bg-surface hover:text-ink">
                  {g.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-10">
          {c.groups.map((g, i) => (
            <section key={g.name} id={`g${i}`} {...(i ? reveal() : {})} className="scroll-mt-24">
              <h2 className="mb-3 flex items-center gap-3 text-heading">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand-text"><Icon name={GROUP_ICON[i] ?? 'shield'} className="h-5 w-5" /></span>
                {g.name}
              </h2>
              <div className="divide-y divide-line rounded-2xl border border-line bg-panel">
                {g.items.map((it) => (
                  <details key={it.q} className="group px-5 py-4">
                    <summary className="flex cursor-pointer items-center justify-between gap-4 text-body-strong">
                      {it.q}
                      <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <p className="mt-2 text-body leading-7 text-muted">{it.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
          <p className="text-small text-muted">
            {all.help.still}{' '}
            <Link href={`/${params.lang}/contact/`} className="font-semibold text-brand-text underline">
              {all.nav.contact}
            </Link>
          </p>
        </div>
      </div>
    </Section>
    </>
  );
}
