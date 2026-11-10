'use client';

import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { demoBackUrl } from '@/lib/demoBack';

/**
 * Client-rendered so it follows the language toggle in the static demo. When the demo was
 * opened from the marketing website it also offers the way back; opened on its own, it doesn't.
 */
export function DemoBanner() {
  const { t } = useTranslation();
  const [back, setBack] = useState<string | null>(null);
  useEffect(() => setBack(demoBackUrl()), []);
  return (
    <div data-demo-banner className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 bg-brand px-4 py-2 text-center text-sm font-medium text-brand-contrast">
      {back ? (
        <a href={back} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 font-semibold hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('demo.back')}
        </a>
      ) : null}
      <p>{t('demo.banner')}</p>
    </div>
  );
}
