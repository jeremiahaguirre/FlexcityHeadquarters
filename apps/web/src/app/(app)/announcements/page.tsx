'use client';

import { useTranslation } from 'react-i18next';
import { MyAnnouncements } from '@/components/communication/Notices';
import { PageHeader } from '@/components/ui/PageHeader';

/** Announcements for everyone, whatever their role: new ones, and earlier ones to read again. Notifications link here. */
export default function AnnouncementsPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('announcements.title')} description={t('announcements.pageHelp')} />
      <MyAnnouncements all />
    </div>
  );
}
