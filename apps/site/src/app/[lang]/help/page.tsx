import { pageMeta } from '@/lib/seo';
import { Section, SectionHead } from '@/components/Section';
import { HelpIndex } from '@/components/HelpIndex';
import { type Lang, copy } from '@/content/copy';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).help;
  return pageMeta(params.lang, 'help/', c.title, c.lead);
}

export default function Help({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang).help;
  return (
    <Section>
      <SectionHead title={c.title} lead={c.lead} />
      <HelpIndex lang={params.lang} />
    </Section>
  );
}
