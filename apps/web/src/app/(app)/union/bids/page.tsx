'use client';

import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BidRounds } from '@/components/bidding/BidRounds';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';

/** Union stewards: each closed bid round's seniority order, outcomes and override reasons, read-only. */
export default function UnionBidsPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('bids.observeTitle')} description={t('bids.observeDescription')} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <BidRounds />
      </Suspense>
    </div>
  );
}
