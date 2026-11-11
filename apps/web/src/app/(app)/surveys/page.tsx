'use client';

import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { MySurveys } from '@/components/surveys/MySurveys';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';

/** Staff surveys waiting for this person. */
export default function SurveysPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('surveys.title')} description={t('surveys.intro')} />
      <Suspense fallback={<ListSkeleton />}>
        <MySurveys />
      </Suspense>
    </>
  );
}
