import { SITE_URL, pageMeta } from '@/lib/seo';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Section } from '@/components/Section';
import { PageHero } from '@/components/PageHero';
import { LANGS, type Lang, copy } from '@/content/copy';
import { ARTICLES, articleIn } from '@/content/help';

export const generateStaticParams = () => LANGS.flatMap((lang) => ARTICLES.map((a) => ({ lang, slug: a.slug })));

export async function generateMetadata(props: { params: Promise<{ lang: Lang; slug: string }> }) {
  const params = await props.params;
  const a = ARTICLES.find((x) => x.slug === params.slug);
  return a ? pageMeta(params.lang, `help/${a.slug}/`, articleIn(a, params.lang).title, articleIn(a, params.lang).summary) : {};
}

export default async function Article(props: { params: Promise<{ lang: Lang; slug: string }> }) {
  const params = await props.params;
  const a = ARTICLES.find((x) => x.slug === params.slug);
  if (!a) notFound();
  const b = articleIn(a, params.lang);
  const c = copy(params.lang);
  const url = `${SITE_URL}/${params.lang}/help/${a.slug}/`;
  // Structured data: the steps as a how-to, and where the page sits in the site.
  const ld = [
    { '@context': 'https://schema.org', '@type': 'HowTo', name: b.title, description: b.summary, inLanguage: params.lang === 'fr' ? 'fr-CA' : 'en-CA', url, step: b.steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })) },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'FlexcityHeadquarters', item: `${SITE_URL}/${params.lang}/` },
        { '@type': 'ListItem', position: 2, name: c.help.title, item: `${SITE_URL}/${params.lang}/help/` },
        { '@type': 'ListItem', position: 3, name: b.title, item: url },
      ],
    },
  ];
  return (
    <>
    <PageHero eyebrow={c.help.audience[a.audience]} title={b.title} lead={b.summary} size="md">
      <Link href={`/${params.lang}/help/`} className="mt-6 inline-flex items-center gap-1.5 text-small font-semibold text-[#5EEAD4] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {c.help.back}
      </Link>
    </PageHero>
    <Section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <div className="mx-auto max-w-2xl">
        <ol className="grid gap-4">
          {b.steps.map((s, i) => (
            <li key={s} className="flex gap-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-small font-bold text-brand-contrast">{i + 1}</span>
              <p className="pt-1 text-body leading-7">{s}</p>
            </li>
          ))}
        </ol>
        {b.tip ? (
          <p className="mt-8 flex gap-3 rounded-2xl bg-surface px-5 py-4 text-small">
            <Lightbulb className="h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
            {b.tip}
          </p>
        ) : null}
        <div className="mt-12 rounded-2xl border border-line bg-panel p-6">
          <h2 className="text-subheading">{c.help.still}</h2>
          <p className="mt-1 text-small text-muted">{c.help.stillBody}</p>
          <Link href={`/${params.lang}/contact/?kind=SUPPORT`} className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-5 text-body-strong text-brand-contrast hover:bg-brand-hover">
            {c.nav.contact}
          </Link>
        </div>
      </div>
    </Section>
    </>
  );
}
