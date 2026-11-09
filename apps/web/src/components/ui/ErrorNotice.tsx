'use client';

import { CloudOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

export function ErrorNotice({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl2 border border-line bg-panel px-6 py-10 text-center">
      <CloudOff className="h-6 w-6 text-muted" aria-hidden="true" />
      <p className="max-w-sm text-small text-muted">{t('common.error')}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}
