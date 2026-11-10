'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate, formatMoney } from '@/lib/format';
import { todayIso, useQuery } from '@/lib/useQuery';

interface Remittance { month: string; due: string; statements: number; employeesLastPay: number; grossPayroll: number; cppEmployee: number; cppEmployer: number; eiEmployee: number; eiEmployer: number; incomeTax: number; total: number }
interface Slip { userId: string; name: string; sin: string | null; province: string; box14EmploymentIncome: number; box16Cpp: number; box16aCpp2: number; box18Ei: number; box22IncomeTax: number; box24EiInsurable: number; box26CppPensionable: number }
interface T4 { year: number; slips: Slip[]; summary: { slips: number; box14: number; box16: number; box16a: number; box18: number; box19EmployerEi: number; box22: number; box27EmployerCpp: number; missingSin: string[] }; employer: { name: string; businessNumber: string | null } }
interface Roe { periods: Array<{ periodStart: string; periodEnd: string; insurableEarnings: number; hours: number }>; totalInsurableEarnings: number; totalInsurableHours: number; firstDay: string | null; lastPaidDay: string | null }

/** Remittance to CRA, T4 slips and Record of Employment figures. */
export function PayDocuments() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (n: number) => formatMoney(n, lng);
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [person, setPerson] = useState('');
  const rem = useQuery<Remittance>(`/api/payroll/remittance?month=${month}`);
  const t4 = useQuery<T4>(`/api/payroll/t4?year=${year}`);
  const people = useQuery<{ people: Array<{ id: string; name: string }> }>('/api/payroll/people');
  const roe = useQuery<Roe>(person ? `/api/payroll/roe/${person}` : null);
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('payroll.remittance')} description={t('payroll.remittanceHelp')} action={<Input aria-label={t('payroll.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />} />
        <CardBody className="pt-2">
          {!rem.data ? <Skeleton className="h-32" /> : (
            <dl className="grid gap-3 text-small tabular-nums sm:grid-cols-3">
              {(['cppEmployee', 'cppEmployer', 'eiEmployee', 'eiEmployer', 'incomeTax'] as const).map((k) => (
                <div key={k} className="flex justify-between gap-2 rounded-xl bg-surface px-3 py-2"><dt>{t(`payroll.rem.${k}`)}</dt><dd>{money(rem.data![k])}</dd></div>
              ))}
              <div className="flex justify-between gap-2 rounded-xl bg-brand/10 px-3 py-2 font-semibold"><dt>{t('payroll.rem.total')}</dt><dd>{money(rem.data.total)}</dd></div>
              <p className="text-caption text-muted sm:col-span-3">{t('payroll.rem.due', { date: formatDate(rem.data.due, lng, 'dated'), gross: money(rem.data.grossPayroll), people: rem.data.employeesLastPay })}</p>
            </dl>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('payroll.t4s')} description={t('payroll.t4sHelp')} action={<Input aria-label={t('payroll.year')} type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />} />
        <CardBody className="grid gap-3 pt-2">
          {!t4.data ? <Skeleton className="h-32" /> : (
            <>
              {t4.data.summary.missingSin.length ? <p className="rounded-xl bg-warn/10 px-3 py-2 text-small">{t('payroll.missingSin', { names: t4.data.summary.missingSin.join(', ') })}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-small tabular-nums">
                  <thead className="text-left text-caption text-muted"><tr><th className="py-1.5 font-semibold">{t('payroll.employee')}</th><th className="py-1.5 font-semibold">10</th><th className="py-1.5 text-right font-semibold">14</th><th className="py-1.5 text-right font-semibold">16</th><th className="py-1.5 text-right font-semibold">16A</th><th className="py-1.5 text-right font-semibold">18</th><th className="py-1.5 text-right font-semibold">22</th><th className="py-1.5 text-right font-semibold">24</th><th className="py-1.5 text-right font-semibold">26</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {t4.data.slips.map((s) => (
                      <tr key={s.userId}><td className="py-1.5">{s.name}<span className="block text-caption text-muted">{s.sin ?? t('payroll.missing')}</span></td><td className="py-1.5">{s.province}</td><td className="py-1.5 text-right">{money(s.box14EmploymentIncome)}</td><td className="py-1.5 text-right">{money(s.box16Cpp)}</td><td className="py-1.5 text-right">{money(s.box16aCpp2)}</td><td className="py-1.5 text-right">{money(s.box18Ei)}</td><td className="py-1.5 text-right">{money(s.box22IncomeTax)}</td><td className="py-1.5 text-right">{money(s.box24EiInsurable)}</td><td className="py-1.5 text-right">{money(s.box26CppPensionable)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-caption text-muted">{t('payroll.t4Summary', { slips: t4.data.summary.slips, income: money(t4.data.summary.box14), cpp: money(t4.data.summary.box16 + t4.data.summary.box27EmployerCpp), ei: money(t4.data.summary.box18 + t4.data.summary.box19EmployerEi), tax: money(t4.data.summary.box22) })}</p>
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('payroll.roe')} description={t('payroll.roeHelp')} />
        <CardBody className="grid gap-3 pt-2">
          <Field label={t('payroll.employee')}>
            {(p) => (
              <Select {...p} value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">{t('payroll.choosePerson')}</option>
                {(people.data?.people ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}
          </Field>
          {roe.data ? (
            <div className="grid gap-2 text-small tabular-nums">
              <p>{t('payroll.roeTotals', { hours: roe.data.totalInsurableHours, earnings: money(roe.data.totalInsurableEarnings), first: roe.data.firstDay ? formatDate(roe.data.firstDay, lng, 'dated') : '—', last: roe.data.lastPaidDay ? formatDate(roe.data.lastPaidDay, lng, 'dated') : '—' })}</p>
              <ul className="divide-y divide-line">{roe.data.periods.map((p) => <li key={p.periodStart} className="flex justify-between py-1.5"><span>{formatDate(p.periodStart, lng)} – {formatDate(p.periodEnd, lng)}</span><span>{p.hours} h · {money(p.insurableEarnings)}</span></li>)}</ul>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
