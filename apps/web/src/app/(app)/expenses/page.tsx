'use client';

import { useTranslation } from 'react-i18next';
import { MyExpenses } from '@/components/payroll/Expenses';
import { PageHeader } from '@/components/ui/PageHeader';

export default function ExpensesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('expenses.pageTitle')} description={t('expenses.pageHelp')} />
      <MyExpenses />
    </>
  );
}
