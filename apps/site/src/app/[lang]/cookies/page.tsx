import { LegalPage, legalTitle } from '@/components/LegalPage';
import { legalDoc } from '@/content/legal';
import { pageMeta } from '@/lib/seo';
import type { Lang } from '@/content/copy';

export async function generateMetadata(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  const intro = legalDoc('cookies', params.lang).intro;
  return pageMeta(params.lang, 'cookies/', legalTitle('cookies', params.lang), intro.length > 160 ? `${intro.slice(0, intro.lastIndexOf(' ', 157))}…` : intro);
}

export default async function Page(props: { params: Promise<{ lang: Lang }> }) {
  const params = await props.params;
  return <LegalPage doc="cookies" lang={params.lang} />;
}
