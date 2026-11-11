'use client';

import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BidRounds } from '@/components/bidding/BidRounds';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';

/** Bid rounds: open one, review the awards proposed in seniority order, change one with a reason, confirm. */
export default function ManageBidsPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('bids.manageTitle')} description={t('bids.manageDescription')} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <BidRounds />
      </Suspense>
    </div>
  );
}
