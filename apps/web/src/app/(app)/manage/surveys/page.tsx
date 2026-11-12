'use client';

import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { SurveyAdmin } from '@/components/surveys/SurveyAdmin';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';

/** HR and managers (if allowed): staff surveys and their results. */
export default function ManageSurveysPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('surveyAdmin.pageTitle')} description={t('surveyAdmin.pageIntro')} />
      <Suspense fallback={<ListSkeleton />}>
        <SurveyAdmin />
      </Suspense>
    </>
  );
}
