import { pageMeta } from '@/lib/seo';
import { ContactForm } from '@/components/ContactForm';
import { Section } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).contact;
  return pageMeta(params.lang, 'contact/', c.title, c.lead);
}

export default function Contact({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).contact;
  return (
    <Section>
      <div className="mx-auto max-w-2xl">
        <div className="rise mb-8">
          <h1 className="text-title [text-wrap:balance]">{c.title}</h1>
          <p className="mt-3 text-body text-muted">{c.lead}</p>
        </div>
        <div className="rise rise-2 rounded-2xl border border-line bg-panel p-6 shadow-card sm:p-8">
          <ContactForm lang={params.lang} />
        </div>
      </div>
    </Section>
  );
}
