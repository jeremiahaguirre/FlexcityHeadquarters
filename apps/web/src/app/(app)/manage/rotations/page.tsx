'use client';

import { useTranslation } from 'react-i18next';
import { Rotations } from '@/components/scheduling/Rotations';
import { PageHeader } from '@/components/ui/PageHeader';

/** Rotation templates (4-on-4-off, 2-2-3, weekdays, custom cycles) and Generate shifts. */
export default function RotationsPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('rotations.title')} description={t('rotations.description')} />
      <Rotations />
    </div>
  );
}
