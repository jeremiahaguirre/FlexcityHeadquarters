'use client';

import { useTranslation } from 'react-i18next';
import { Logbook } from '@/components/communication/Notices';
import { PageHeader } from '@/components/ui/PageHeader';

export default function LogbookPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('logbook.title')} description={t('logbook.help')} />
      <Logbook />
    </>
  );
}
