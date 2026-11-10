'use client';

import { useTranslation } from 'react-i18next';
import { AnnouncementsAdmin } from '@/components/communication/Notices';
import { PageHeader } from '@/components/ui/PageHeader';

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('announcements.manageTitle')} description={t('announcements.manageHelp')} />
      <AnnouncementsAdmin />
    </>
  );
}
