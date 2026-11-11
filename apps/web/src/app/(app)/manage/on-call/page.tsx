'use client';

import { useTranslation } from 'react-i18next';
import { OnCall } from '@/components/scheduling/OnCall';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSession } from '@/lib/session';

/** On-call (standby) rosters per department, swaps and call-backs. */
export default function OnCallPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('onCall.title')} description={t('onCall.description')} />
      <OnCall canWrite={can('schedule.write')} />
    </div>
  );
}
