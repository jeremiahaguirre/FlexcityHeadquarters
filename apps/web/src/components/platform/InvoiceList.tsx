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
  const period = (i: InvoiceRow) => dateFormat(lng, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${i.periodStart}T12:00:00Z`));
  return (
    <>
    {/* Phones: one row per invoice, the way other lists in the console read on a phone. */}
    <ul className="-mx-5 divide-y divide-line border-y border-line md:hidden">
      {invoices.map((i) => (
        <li key={i.id}>
          <Link href={`/platform/invoice?id=${i.id}`} className="block px-5 py-3 hover:bg-surface/60">
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold text-brand-text">{i.number ?? t('billing.draftLabel')}</span>
                {showOrg ? <span className="block truncate text-small">{i.organization?.name ?? '—'}</span> : null}
              </span>
              <StatusPill tone={STATUS_TONE[i.status]}>{t(`billing.status.${i.status}`)}</StatusPill>
            </span>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-small tabular-nums">
              <div><dt className="text-caption text-muted">{t('billing.period')}</dt><dd>{period(i)}</dd></div>
              <div><dt className="text-caption text-muted">{t('billing.due')}</dt><dd>{d(i.dueDate)}</dd></div>
              <div><dt className="text-caption text-muted">{t('billing.total')}</dt><dd>{cad(i.totalCents, lng)}</dd></div>
              <div><dt className="text-caption text-muted">{t('billing.balance')}</dt><dd className="font-semibold">{cad(i.balanceCents, lng)}</dd></div>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
    <div className="-mx-5 hidden overflow-x-auto md:block">
      <table className="w-full min-w-[44rem] text-small">
        <thead>
          <tr className="text-left text-caption font-semibold text-muted">
            <th className="whitespace-nowrap px-5 py-2 font-semibold">{t('billing.invoice')}</th>
            {showOrg ? <th className="py-2 pr-4 font-semibold">{t('billing.organization')}</th> : null}
            <th className="whitespace-nowrap py-2 pr-4 font-semibold">{t('billing.period')}</th>
            <th className="whitespace-nowrap py-2 pr-4 font-semibold">{t('billing.due')}</th>
            <th className="whitespace-nowrap py-2 pl-4 text-right font-semibold">{t('billing.total')}</th>
            <th className="whitespace-nowrap py-2 pl-6 text-right font-semibold">{t('billing.balance')}</th>
            <th className="whitespace-nowrap px-5 py-2 text-right font-semibold">{t('staff.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {invoices.map((i) => (
            <tr key={i.id} className="hover:bg-surface/60">
              <td className="whitespace-nowrap px-5 py-2.5">
                <Link href={`/platform/invoice?id=${i.id}`} className="font-semibold text-brand-text hover:underline">
                  {i.number ?? t('billing.draftLabel')}
                </Link>
              </td>
              {showOrg ? <td className="py-2.5 pr-4">{i.organization?.name ?? '—'}</td> : null}
              <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums">{period(i)}</td>
              <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums">{d(i.dueDate)}</td>
              <td className="whitespace-nowrap py-2.5 pl-4 text-right tabular-nums">{cad(i.totalCents, lng)}</td>
              <td className="whitespace-nowrap py-2.5 pl-6 text-right font-semibold tabular-nums">{cad(i.balanceCents, lng)}</td>
              <td className="whitespace-nowrap px-5 py-2.5 text-right">
                <StatusPill tone={STATUS_TONE[i.status]}>{t(`billing.status.${i.status}`)}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
