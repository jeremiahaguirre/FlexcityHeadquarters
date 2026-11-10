import { pageMeta } from '@/lib/seo';
import { Section } from '@/components/Section';
import { PageHero } from '@/components/PageHero';
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
    <>
      <PageHero eyebrow={copy(params.lang).nav.help} title={c.title} lead={c.lead} size="md" />
      <Section>
        <HelpIndex lang={params.lang} />
      </Section>
    </>
  );
}
