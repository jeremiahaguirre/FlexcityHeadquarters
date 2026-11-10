'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

/** "© 2026 FlexcityHeadquarters. All rights reserved." */
export function Copyright({ className }: { className?: string }) {
  const { t } = useTranslation();
  return <p className={cn('text-caption text-muted', className)}>{t('app.copyright', { year: new Date().getFullYear() })}</p>;
}
