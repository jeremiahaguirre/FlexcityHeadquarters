'use client';

import { useTranslation } from 'react-i18next';
import { MessageReports } from '@/components/messages/MessageReports';
import { PageHeader } from '@/components/ui/PageHeader';

/** HR: reported messages, investigations and the organization's messaging settings. */
export default function MessageReportsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('messageReports.title')} description={t('messageReports.intro')} />
      <MessageReports />
    </>
  );
}
