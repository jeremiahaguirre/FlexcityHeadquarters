'use client';

import { useTranslation } from 'react-i18next';
import { ShiftTemplates } from '@/components/scheduling/ShiftTemplates';
import { PageHeader } from '@/components/ui/PageHeader';

/** Weekly shift templates: a department's standard week, applied to future weeks as draft shifts. */
export default function ShiftTemplatesPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('shiftTemplates.title')} description={t('shiftTemplates.description')} />
      <ShiftTemplates />
    </div>
  );
}
