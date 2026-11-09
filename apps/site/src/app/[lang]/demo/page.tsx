import { pageMeta } from '@/lib/seo';
import { ArrowUpRight } from 'lucide-react';
import { LeadForm } from '@/components/LeadForm';
import { reveal } from '@/lib/reveal';
import { Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { demoLink } from '@/lib/site';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).demo;
  return pageMeta(params.lang, 'demo/', c.title, c.lead);
}

export default function Demo({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).demo;
  return (
    <>
      <Section>
        <SectionHead title={c.title} lead={c.lead} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.roles.map((r, i) => (
            <a key={r.id} href={demoLink(r.id, params.lang)} {...reveal(i)} className="lift group flex flex-col rounded-2xl border border-line bg-panel p-6 shadow-card">
              <h2 className="text-heading">{r.title}</h2>
              <p className="mt-2 flex-1 text-small text-muted">{r.body}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-small font-semibold text-brand-text">
                {c.open}
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </a>
          ))}
        </div>
      </Section>
      <Section tone="panel">
        <div {...reveal()} className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHead title={c.guidedTitle} lead={c.guidedBody} />
          <LeadForm lang={params.lang} kind="DEMO" />
        </div>
      </Section>
    </>
  );
}
