'use client';

import { useTranslation } from 'react-i18next';
import { ExpenseApprovals } from '@/components/payroll/Expenses';
import { PageHeader } from '@/components/ui/PageHeader';

export default function ManageExpensesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('expenses.manageTitle')} description={t('expenses.manageHelp')} />
      <ExpenseApprovals />
    </>
  );
}
