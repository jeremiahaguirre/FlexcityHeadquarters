'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/components/ui/StatusPill';
import { type InvoiceRow, STATUS_TONE, cad } from '@/lib/billing';
import { formatDate, dateFormat } from '@/lib/format';

export function InvoiceList({ invoices, showOrg = true }: { invoices: InvoiceRow[]; showOrg?: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const d = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00`, lng, 'dated') : '—');
  if (!invoices.length) return <p className="text-small text-muted">{t('billing.noInvoices')}</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-small">
        <thead>
          <tr className="text-left text-label uppercase text-muted">
            <th className="px-5 py-2 font-semibold">{t('billing.invoice')}</th>
            {showOrg ? <th className="py-2 font-semibold">{t('billing.organization')}</th> : null}
            <th className="py-2 font-semibold">{t('billing.period')}</th>
            <th className="py-2 font-semibold">{t('billing.due')}</th>
            <th className="py-2 text-right font-semibold">{t('billing.total')}</th>
            <th className="py-2 text-right font-semibold">{t('billing.balance')}</th>
            <th className="px-5 py-2 text-right font-semibold">{t('staff.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {invoices.map((i) => (
            <tr key={i.id} className="hover:bg-surface/60">
              <td className="px-5 py-2.5">
                <Link href={`/platform/invoice?id=${i.id}`} className="font-semibold text-brand-text hover:underline">
                  {i.number ?? t('billing.draftLabel')}
                </Link>
              </td>
              {showOrg ? <td className="py-2.5">{i.organization?.name ?? '—'}</td> : null}
              <td className="py-2.5 tabular-nums">{dateFormat(lng, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${i.periodStart}T12:00:00Z`))}</td>
              <td className="py-2.5 tabular-nums">{d(i.dueDate)}</td>
              <td className="py-2.5 text-right tabular-nums">{cad(i.totalCents, lng)}</td>
              <td className="py-2.5 text-right font-semibold tabular-nums">{cad(i.balanceCents, lng)}</td>
              <td className="px-5 py-2.5 text-right">
                <StatusPill tone={STATUS_TONE[i.status]}>{t(`billing.status.${i.status}`)}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
