'use client';

import { useTranslation } from 'react-i18next';
import { TrainingPanel } from '@/components/hr/Training';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSession } from '@/lib/session';

export default function TrainingPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  // Courses are set up by HR; supervisors record sessions for their department.
  const hr = !!me?.roles.includes('HR_ADMIN');
  return (
    <div className="grid gap-6">
      <PageHeader title={t('training.title')} description={hr ? t('training.descriptionHr') : t('training.description')} />
      <TrainingPanel canSetUp={hr} />
    </div>
  );
}
