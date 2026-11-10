'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/Segmented';
import type { Departments } from '@/lib/departments';
import { useQuery } from '@/lib/useQuery';

/**
 * Department tabs for HR (All · Aquatics · Water Works · No department). A
 * supervisor limited to one department sees no tabs: their list is already theirs.
 */
export function DepartmentTabs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t, i18n } = useTranslation();
  const data = useQuery<Departments>('/api/departments');
  const d = data.data;
  const known = !d || value === '' || value === 'none' || d.departments.some((x) => x.id === value);
  // A remembered tab that no longer exists (or isn't theirs) falls back to everyone.
  useEffect(() => {
    if (!known) onChange('');
  }, [known, onChange]);
  if (!d || !d.departments.length || (d.limited && d.departments.length < 2)) return null;
  const name = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const options = [
    { value: '', label: t('departments.all') },
    ...d.departments.map((x) => ({ value: x.id, label: name(x) })),
    ...(d.limited ? [] : [{ value: 'none', label: t('departments.none') }]),
  ];
  return (
    <div className="max-w-full overflow-x-auto">
      <Segmented label={t('departments.tabs')} value={known ? value : ''} onChange={onChange} options={options} />
    </div>
  );
}
