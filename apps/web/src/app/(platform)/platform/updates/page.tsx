'use client';

import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/ui/PageHeader';
import { NotesPanel } from '@/components/platform/updates/NotesPanel';

/** Dev console: telling organizations about FH's updates (docs/RELEASES.md). */
export default function UpdatesPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('updatesConsole.title')} description={t('updatesConsole.description')} />
      <NotesPanel />
    </div>
  );
}
