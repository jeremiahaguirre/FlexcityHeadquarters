'use client';

import { FillSchedule } from '@/components/FillSchedule';
import { Planner } from '@/components/planner/Planner';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/ui/PageHeader';
import { mondayOf } from '@/lib/tz';
import { todayIso } from '@/lib/useQuery';

/**
 * The schedule builder: schedule by hand (month, week or day; drag people onto shifts) or let
 * Fill the schedule propose a draft. Everything stays a draft until Publish.
 */
export default function ScheduleBuilderPage() {
  const { t } = useTranslation();
  const [filling, setFilling] = useState(false);
  const [refresh, setRefresh] = useState(0);
  return (
    <>
      <PageHeader title={t('builder.title')} description={t('planner.description')} />
      <Planner onOpenFill={() => setFilling(true)} refreshKey={refresh} />
      <FillSchedule open={filling} onClose={() => setFilling(false)} weekStart={mondayOf(todayIso())} onChanged={() => setRefresh((n) => n + 1)} />
    </>
  );
}
