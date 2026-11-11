'use client';

import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/** Shown in place of a menu screen the person can't use (opened from a link or a typed address). */
export function NoAccess() {
  const { t } = useTranslation();
  return (
    <EmptyState level={1} icon={Lock} title={t('noAccess.title')} action={<ButtonLink href="/today" variant="secondary">{t('noAccess.back')}</ButtonLink>}>
      {t('noAccess.body')}
    </EmptyState>
  );
}
