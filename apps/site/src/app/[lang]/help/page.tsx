import { pageMeta } from '@/lib/seo';
import { Section, SectionHead } from '@/components/Section';
import { HelpIndex } from '@/components/HelpIndex';
import { type Lang, copy } from '@/content/copy';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).help;
  return pageMeta(params.lang, 'help/', c.title, c.lead);
}

export default async function Help(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const c = copy(params.lang).help;
  return (
    <Section>
      <SectionHead as="h1" title={c.title} lead={c.lead} />
      <HelpIndex lang={params.lang} />
    </Section>
  );
}
