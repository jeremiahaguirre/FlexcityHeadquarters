import { LegalPage, legalTitle } from '@/components/LegalPage';
import { legalDoc } from '@/content/legal';
import { pageMeta } from '@/lib/seo';
import type { Lang } from '@/content/copy';

export function generateMetadata({ params }: { params: { lang: Lang } }) {
  const intro = legalDoc('privacy', params.lang).intro;
  return pageMeta(params.lang, 'privacy/', legalTitle('privacy', params.lang), intro.length > 160 ? `${intro.slice(0, intro.lastIndexOf(' ', 157))}…` : intro);
}

export default function Page({ params }: { params: { lang: Lang } }) {
  return <LegalPage doc="privacy" lang={params.lang} />;
}
