'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { NotesPanel } from '@/components/platform/updates/NotesPanel';
import { ReleasesPanel } from '@/components/platform/updates/ReleasesPanel';
import type { Ring } from '@/components/platform/updates/shared';
import { usePlatformQuery } from '@/lib/platform';

type Tab = 'notes' | 'releases';

/** Dev console: telling organizations about FH's updates, and rolling features out ring by ring (docs/RELEASES.md). */
export default function UpdatesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('notes');
  const rings = usePlatformQuery<Ring[]>('/rings');
  const features = usePlatformQuery<string[]>('/releases/features');
  return (
    <div className="grid gap-6">
      <PageHeader title={t('updatesConsole.title')} description={t('updatesConsole.description')} />
      <div className="overflow-x-auto">
        <Segmented<Tab> label={t('updatesConsole.title')} value={tab} onChange={setTab} options={[{ value: 'notes', label: t('updatesConsole.tabNotes') }, { value: 'releases', label: t('updatesConsole.tabReleases') }]} />
      </div>
      {tab === 'notes' ? <NotesPanel rings={rings.data ?? []} /> : <ReleasesPanel rings={rings.data} reloadRings={rings.reload} features={features.data ?? []} />}
    </div>
  );
}
