'use client';

import { useTranslation } from 'react-i18next';
import { Preferences } from '@/components/scheduling/Preferences';
import { PageHeader } from '@/components/ui/PageHeader';

/** Shift preferences: what each person would like to work (a wish, unlike availability). */
export default function PreferencesPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('prefs.title')} description={t('prefs.description')} />
      <Preferences />
    </div>
  );
}
