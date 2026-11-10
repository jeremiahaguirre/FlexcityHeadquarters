'use client';

import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { SchemePicker } from './SchemePicker';

export function AppearanceCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t('scheme.title')} description={t('scheme.help')} />
      <CardBody className="pt-2"><SchemePicker className="max-w-sm" /></CardBody>
    </Card>
  );
}
