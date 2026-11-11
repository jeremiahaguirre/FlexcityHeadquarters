'use client';

import { useTranslation } from 'react-i18next';
import { MyBids } from '@/components/bidding/MyBids';
import { PageHeader } from '@/components/ui/PageHeader';

/** Shift bidding: rank the shifts or lines on offer; awards go by seniority. */
export default function BidsPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('bids.title')} description={t('bids.description')} />
      <MyBids />
    </div>
  );
}
