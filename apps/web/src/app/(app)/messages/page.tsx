'use client';

import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Messages } from '@/components/messages/Messages';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';

/** Team messaging: one to one, shift, department and group conversations. */
export default function MessagesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('messages.title')} description={t('messages.intro')} />
      <Suspense fallback={<ListSkeleton />}>
        <Messages />
      </Suspense>
    </>
  );
}
