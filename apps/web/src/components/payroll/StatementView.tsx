'use client';

import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { Statement } from '@/lib/payroll';

/**
 * A statement of earnings: employer, employee, period, hours, rates, every
 * earning and deduction, net pay and year-to-date (what provincial employment
 * standards require on a wage statement). Prints cleanly on its own.
 */
export function StatementView({ s }: { s: Statement }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (n: number) => formatMoney(n, lng);
  const pos = (id: string | null) => {
    const p = s.positions?.find((x) => x.id === id);
    return p ? (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name) : '';
  };
  const d = s.deductions;
  const rows: Array<[string, number, number | undefined]> = [
    [t('payroll.d.cpp'), d.cpp, s.ytd?.cpp],
    ...(d.cpp2 || s.ytd?.cpp2 ? ([[t('payroll.d.cpp2'), d.cpp2, s.ytd?.cpp2]] as Array<[string, number, number | undefined]>) : []),
    [t('payroll.d.ei'), d.ei, s.ytd?.ei],
    [t('payroll.d.federalTax'), d.federalTax + (d.extraTax ?? 0), s.ytd?.federalTax],
    [t('payroll.d.provincialTax', { province: s.province }), d.provincialTax, s.ytd?.provincialTax],
  ];
  return (
    <article className="statement grid grid-cols-[minmax(0,1fr)] gap-5 text-small">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-body-strong">{s.employer?.name}</p>
          {s.employer?.address ? <p className="text-muted">{s.employer.address}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-caption uppercase tracking-wide text-muted">{t('payroll.statement')}</p>
          <p className="text-body-strong">{s.employee?.name}</p>
          {s.employee?.employeeNumber ? <p className="text-muted">#{s.employee.employeeNumber}</p> : null}
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt className="text-caption text-muted">{t('payroll.periodLabel')}</dt><dd>{s.periodStart ? `${formatDate(s.periodStart, lng, 'dated')} – ${formatDate(s.periodEnd!, lng, 'dated')}` : '—'}</dd></div>
        <div><dt className="text-caption text-muted">{t('payroll.payDate')}</dt><dd>{formatDate(s.payDate, lng, 'dated')}</dd></div>
        <div><dt className="text-caption text-muted">{t('payroll.hoursWorked')}</dt><dd className="tabular-nums">{formatNumber(s.hours, lng)}</dd></div>
        <div><dt className="text-caption text-muted">{t('payroll.paidTo')}</dt><dd>{s.deposit ? t('payroll.depositTo', { account: s.deposit }) : t('payroll.byCheque')}</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] tabular-nums">
          <thead className="text-left text-caption text-muted">
            <tr><th className="py-1.5 font-semibold">{t('payroll.earnings')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.hours')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.rate')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.amount')}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s.earnings.map((e, i) => (
              <tr key={i}>
                <td className="py-1.5">{t(`payroll.codes.${e.code}`, { defaultValue: e.code })}{pos(e.positionId) ? <span className="text-muted"> · {pos(e.positionId)}</span> : null}</td>
                <td className="py-1.5 text-right">{e.hours ? formatNumber(e.hours, lng) : ''}</td>
                <td className="py-1.5 text-right">{e.rate ? money(e.rate) : ''}</td>
                <td className="py-1.5 text-right">{money(e.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className="py-2">{t('payroll.gross')}</td><td /><td /><td className="py-2 text-right">{money(s.gross)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] tabular-nums">
          <thead className="text-left text-caption text-muted">
            <tr><th className="py-1.5 font-semibold">{t('payroll.deductions')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.thisPay')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.yearToDate')}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, now, ytd]) => (
              <tr key={label}><td className="py-1.5">{label}</td><td className="py-1.5 text-right">{money(now)}</td><td className="py-1.5 text-right text-muted">{ytd != null ? money(ytd) : ''}</td></tr>
            ))}
            <tr className="font-semibold"><td className="py-2">{t('payroll.totalDeductions')}</td><td className="py-2 text-right">{money(s.totalDeductions)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-surface p-4">
        <div>
          <p className="text-caption text-muted">{t('payroll.netPay')}</p>
          <p className="text-title tabular-nums">{money(s.net)}</p>
        </div>
        <div className="text-right text-caption text-muted">
          <p>{t('payroll.ytdGross', { amount: money(s.ytd?.gross ?? s.gross) })}</p>
          <p>{t('payroll.ytdNet', { amount: money(s.ytd?.net ?? s.net) })}</p>
        </div>
      </div>
      <div className="print:hidden">
        <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={() => window.print()}>{t('payroll.print')}</Button>
      </div>
    </article>
  );
}
