'use client';

import { useTranslation } from 'react-i18next';
import { SurveyAdmin } from '@/components/surveys/SurveyAdmin';
import { PageHeader } from '@/components/ui/PageHeader';

/** HR and managers (if allowed): staff surveys and their results. */
export default function ManageSurveysPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('surveyAdmin.pageTitle')} description={t('surveyAdmin.pageIntro')} />
      <SurveyAdmin />
    </>
  );
}
