import { pageMeta } from '@/lib/seo';
import { Mail } from 'lucide-react';
import { ContactForm } from '@/components/ContactForm';
import { Section, SectionHead } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { SITE } from '@/lib/site';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).contact;
  return pageMeta(params.lang, 'contact/', c.title, c.lead);
}

export default function Contact({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).contact;
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SectionHead title={c.title} lead={c.lead} />
          <p className="flex items-center gap-2 text-body">
            <Mail className="h-5 w-5 text-brand-text" aria-hidden="true" />
            <a href={`mailto:${SITE.contactEmail}`} className="font-semibold text-brand-text hover:underline">
              {SITE.contactEmail}
            </a>
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-6 shadow-card sm:p-8">
          <ContactForm lang={params.lang} />
        </div>
      </div>
    </Section>
  );
}
