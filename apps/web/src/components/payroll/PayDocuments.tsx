'use client';

import { FileDown } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { apiDownload, saveBlob } from '@/lib/api';
import { DEMO } from '@/lib/demo';
import { formatDate, formatMoney } from '@/lib/format';
import { todayIso, useQuery } from '@/lib/useQuery';
import { QuebecTraining, type Skills } from './QuebecTraining';

interface RevenuQuebec { grossPayroll: number; qppEmployee: number; qppEmployer: number; qpipEmployee: number; qpipEmployer: number; quebecTax: number; total: number; due: string; hsf?: { rate: number; sector: string; estimatedAnnualPayroll: number; amount: number } | null }
interface Remittance { month: string; due: string; statements: number; employeesLastPay: number; grossPayroll: number; cppEmployee: number; cppEmployer: number; eiEmployee: number; eiEmployer: number; incomeTax: number; total: number; revenuQuebec?: RevenuQuebec | null }
interface Rl1Slip { userId: string; name: string; sin: string | null; boxA: number; boxBA: number; boxBB: number; boxC: number; boxD: number; boxE: number; boxF: number; boxG: number; boxH: number; boxI: number; boxL: number }
interface Rl1 { year: number; slips: Rl1Slip[]; summary: { slips: number; boxA: number; boxBA: number; boxE: number; boxH: number; employerQpp: number; employerQpip: number; missingSin: string[]; contributions?: ({ sector: string; payroll: number; hsfRate: number; hsf: number; cnt: number } & Skills) | null }; employer: { name: string; quebecNumber: string | null } }
interface Slip { userId: string; name: string; sin: string | null; province: string; box14EmploymentIncome: number; box16Cpp: number; box16aCpp2: number; box17Qpp?: number; box55Ppip?: number; box18Ei: number; box22IncomeTax: number; box24EiInsurable: number; box26CppPensionable: number }
interface T4 { year: number; slips: Slip[]; summary: { slips: number; box14: number; box16: number; box16a: number; box18: number; box19EmployerEi: number; box22: number; box27EmployerCpp: number; missingSin: string[] }; employer: { name: string; businessNumber: string | null } }
interface Roe { periods: Array<{ periodStart: string; periodEnd: string; insurableEarnings: number; hours: number }>; totalInsurableEarnings: number; totalInsurableHours: number; firstDay: string | null; lastPaidDay: string | null }

/** Remittances to CRA (and Revenu Québec), T4 and RL-1 slips, and Record of Employment figures. */
export function PayDocuments() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (n: number) => formatMoney(n, lng);
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [person, setPerson] = useState('');
  const rem = useQuery<Remittance>(`/api/payroll/remittance?month=${month}`);
  const t4 = useQuery<T4>(`/api/payroll/t4?year=${year}`);
  const rl1 = useQuery<Rl1>(`/api/payroll/rl1?year=${year}`);
  const anyQc = !!t4.data?.slips.some((s) => s.box17Qpp);
  const people = useQuery<{ people: Array<{ id: string; name: string }> }>('/api/payroll/people');
  const roe = useQuery<Roe>(person ? `/api/payroll/roe/${person}` : null);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ key: string; list: Array<{ code: string; name?: string }> }>({ key: '', list: [] });
  const [recall, setRecall] = useState<'Y' | 'N' | 'U'>('U');
  /** Downloads a filing file; when details are missing, lists them instead. */
  async function file(key: string, path: string, name: string, body?: unknown) {
    if (DEMO) return toast(t('payroll.filing.demo'), 'warn');
    setBusy(key);
    setProblems({ key: '', list: [] });
    try {
      const r = await apiDownload(path, true, body);
      if (r.ok) {
        saveBlob(r.blob, name);
        toast(t('payroll.filing.saved'), 'ok');
      } else if (r.error.code === 'FILING_INCOMPLETE') {
        setProblems({ key: key.startsWith('rl1') ? 'rl1' : key === 'roe' ? 'roe' : 't4', list: (r.error.details as { problems?: Array<{ code: string; name?: string }> } | undefined)?.problems ?? [] });
      } else toast(String(r.error.message ?? t('common.error')), 'warn');
    } finally {
      setBusy(null);
    }
  }
  function roeFile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim() || null;
    const name = people.data?.people.find((x) => x.id === person)?.name.replace(/\W+/g, '-') ?? 'ROE';
    void file('roe', `/api/payroll/roe/${person}/xml`, `ROE-${name}.xml`, { reason: v('reason'), recall, recallDate: recall === 'Y' ? v('recallDate') : null, lastDay: v('lastDay'), occupation: v('occupation'), comments: v('comments') });
  }
  const problemList = (key: string) => problems.key === key && problems.list.length ? (
    <div className="rounded-xl bg-warn/10 px-3 py-2 text-small" role="alert">
      <p className="font-semibold">{t('payroll.filing.missing')}</p>
      <ul className="mt-1 list-disc pl-5">{problems.list.map((p) => <li key={`${p.code}-${p.name ?? ''}`}>{t(`payroll.filing.problems.${p.code}`, { name: p.name })}</li>)}</ul>
    </div>
  ) : null;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('payroll.remittance')} description={t('payroll.remittanceHelp')} action={<Input aria-label={t('payroll.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />} />
        <CardBody className="pt-2">
          {!rem.data ? <Skeleton className="h-32" /> : (
            <div className="grid gap-3 text-small tabular-nums sm:grid-cols-3">
              {(['cppEmployee', 'cppEmployer', 'eiEmployee', 'eiEmployer', 'incomeTax'] as const).map((k) => (
                <dl key={k} className="flex justify-between gap-2 rounded-xl bg-surface px-3 py-2"><dt>{t(`payroll.rem.${k}`)}</dt><dd>{money(rem.data![k])}</dd></dl>
              ))}
              <dl className="flex justify-between gap-2 rounded-xl bg-brand/10 px-3 py-2 font-semibold"><dt>{t('payroll.rem.total')}</dt><dd>{money(rem.data.total)}</dd></dl>
              <p className="text-caption text-muted sm:col-span-3">{t('payroll.rem.due', { date: formatDate(rem.data.due, lng, 'dated'), gross: money(rem.data.grossPayroll), people: rem.data.employeesLastPay })}</p>
              {rem.data.revenuQuebec ? (
                <div className="grid gap-3 border-t border-line pt-3 sm:col-span-3 sm:grid-cols-3">
                  <p className="text-body-strong sm:col-span-3">{t('payroll.rq.title')}</p>
                  {(['qppEmployee', 'qppEmployer', 'qpipEmployee', 'qpipEmployer', 'quebecTax'] as const).map((k) => (
                    <dl key={k} className="flex justify-between gap-2 rounded-xl bg-surface px-3 py-2"><dt>{t(`payroll.rq.${k}`)}</dt><dd>{money(rem.data!.revenuQuebec![k])}</dd></dl>
                  ))}
                  {rem.data.revenuQuebec.hsf ? (
                    <dl className="flex justify-between gap-2 rounded-xl bg-surface px-3 py-2"><dt>{t('payroll.rq.hsf', { rate: (rem.data.revenuQuebec.hsf.rate * 100).toFixed(2) })}</dt><dd>{money(rem.data.revenuQuebec.hsf.amount)}</dd></dl>
                  ) : null}
                  <dl className="flex justify-between gap-2 rounded-xl bg-brand/10 px-3 py-2 font-semibold"><dt>{t('payroll.rq.total')}</dt><dd>{money(rem.data.revenuQuebec.total + (rem.data.revenuQuebec.hsf?.amount ?? 0))}</dd></dl>
                  <p className="text-caption text-muted sm:col-span-3">{t('payroll.rq.note')}</p>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('payroll.t4s')} description={t('payroll.t4sHelp')} action={<Input aria-label={t('payroll.year')} type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />} />
        <CardBody className="grid gap-3 pt-2">
          {t4.data?.slips.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={<FileDown className="h-4 w-4" aria-hidden="true" />} loading={busy === 't4'} onClick={() => void file('t4', `/api/payroll/t4.xml?year=${year}`, `T4-${year}.xml`)}>{t('payroll.filing.t4Xml')}</Button>
              <Button size="sm" variant="ghost" loading={busy === 't4a'} onClick={() => void file('t4a', `/api/payroll/t4.xml?year=${year}&type=A`, `T4-${year}-amended.xml`)}>{t('payroll.filing.t4Amended')}</Button>
              <span className="text-caption text-muted">{t('payroll.filing.t4Hint')}</span>
            </div>
          ) : null}
          {problemList('t4')}
          {!t4.data ? <Skeleton className="h-32" /> : (
            <>
              {t4.data.summary.missingSin.length ? <p className="rounded-xl bg-warn/10 px-3 py-2 text-small">{t('payroll.missingSin', { names: t4.data.summary.missingSin.join(', ') })}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-small tabular-nums">
                  <thead className="text-left text-caption text-muted"><tr><th className="py-1.5 font-semibold">{t('payroll.employee')}</th><th className="py-1.5 font-semibold">10</th><th className="py-1.5 text-right font-semibold">14</th><th className="py-1.5 text-right font-semibold">16</th><th className="py-1.5 text-right font-semibold">16A</th>{anyQc ? <><th className="py-1.5 text-right font-semibold">17</th><th className="py-1.5 text-right font-semibold">55</th></> : null}<th className="py-1.5 text-right font-semibold">18</th><th className="py-1.5 text-right font-semibold">22</th><th className="py-1.5 text-right font-semibold">24</th><th className="py-1.5 text-right font-semibold">26</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {t4.data.slips.map((s) => (
                      <tr key={s.userId}><td className="py-1.5">{s.name}<span className="block text-caption text-muted">{s.sin ?? t('payroll.missing')}</span></td><td className="py-1.5">{s.province}</td><td className="py-1.5 text-right">{money(s.box14EmploymentIncome)}</td><td className="py-1.5 text-right">{money(s.box16Cpp)}</td><td className="py-1.5 text-right">{money(s.box16aCpp2)}</td>{anyQc ? <><td className="py-1.5 text-right">{money(s.box17Qpp ?? 0)}</td><td className="py-1.5 text-right">{money(s.box55Ppip ?? 0)}</td></> : null}<td className="py-1.5 text-right">{money(s.box18Ei)}</td><td className="py-1.5 text-right">{money(s.box22IncomeTax)}</td><td className="py-1.5 text-right">{money(s.box24EiInsurable)}</td><td className="py-1.5 text-right">{money(s.box26CppPensionable)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-caption text-muted">{t('payroll.t4Summary', { slips: t4.data.summary.slips, income: money(t4.data.summary.box14), cpp: money(t4.data.summary.box16 + t4.data.summary.box27EmployerCpp), ei: money(t4.data.summary.box18 + t4.data.summary.box19EmployerEi), tax: money(t4.data.summary.box22) })}</p>
            </>
          )}
        </CardBody>
      </Card>
      {rl1.data?.slips.length ? (
        <Card>
          <CardHeader title={t('payroll.rl1.title')} description={t('payroll.rl1.help')} />
          <CardBody className="grid gap-3 pt-2">
            {!rl1.data.employer.quebecNumber ? <p className="rounded-xl bg-warn/10 px-3 py-2 text-small">{t('payroll.rl1.noNumber')}</p> : null}
            {rl1.data.summary.missingSin.length ? <p className="rounded-xl bg-warn/10 px-3 py-2 text-small">{t('payroll.missingSin', { names: rl1.data.summary.missingSin.join(', ') })}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={<FileDown className="h-4 w-4" aria-hidden="true" />} loading={busy === 'rl1'} onClick={() => void file('rl1', `/api/payroll/rl1.xml?year=${year}`, `RL-1-${year}.xml`)}>{t('payroll.filing.rl1Xml')}</Button>
              <Button size="sm" variant="ghost" loading={busy === 'rl1a'} onClick={() => void file('rl1a', `/api/payroll/rl1.xml?year=${year}&type=A`, `RL-1-${year}-amended.xml`)}>{t('payroll.filing.rl1Amended')}</Button>
              <span className="text-caption text-muted">{t('payroll.filing.rl1Hint')}</span>
            </div>
            {problemList('rl1')}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-small tabular-nums">
                <thead className="text-left text-caption text-muted"><tr><th className="py-1.5 font-semibold">{t('payroll.employee')}</th>{(['A', 'B.A', 'B.B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const).map((b) => <th key={b} className="py-1.5 text-right font-semibold">{b}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {rl1.data.slips.map((s) => (
                    <tr key={s.userId}>
                      <td className="py-1.5">{s.name}<span className="block text-caption text-muted">{s.sin ?? t('payroll.missing')}</span></td>
                      {([s.boxA, s.boxBA, s.boxBB, s.boxC, s.boxD, s.boxE, s.boxF, s.boxG, s.boxH, s.boxI] as number[]).map((v, i) => <td key={i} className="py-1.5 text-right">{money(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rl1.data.summary.contributions ? (
              <p className="text-small">{t('payroll.rl1.contributions', { hsf: money(rl1.data.summary.contributions.hsf), rate: (rl1.data.summary.contributions.hsfRate * 100).toFixed(2), cnt: money(rl1.data.summary.contributions.cnt), wsdrf: money(rl1.data.summary.contributions.wsdrfOwed ?? rl1.data.summary.contributions.wsdrfBeforeTraining) })}</p>
            ) : null}
            <p className="text-caption text-muted">{t('payroll.rl1.summary', { slips: rl1.data.summary.slips, income: money(rl1.data.summary.boxA), qpp: money(rl1.data.summary.boxBA + rl1.data.summary.employerQpp), qpip: money(rl1.data.summary.boxH + rl1.data.summary.employerQpip), tax: money(rl1.data.summary.boxE) })}</p>
          </CardBody>
        </Card>
      ) : null}
      {rl1.data?.slips.length && rl1.data.summary.contributions ? <QuebecTraining year={year} skills={rl1.data.summary.contributions} onChange={() => void rl1.reload()} /> : null}
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
              {roe.data.periods.length ? (
                <form className="mt-2 grid gap-3 border-t border-line pt-4" onSubmit={roeFile}>
                  <p className="text-body-strong">{t('payroll.filing.roeTitle')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('payroll.filing.reason')}>
                      {(p) => (
                        <Select {...p} name="reason" required defaultValue="">
                          <option value="" disabled>{t('payroll.choosePerson')}</option>
                          {(['A', 'D', 'E', 'G', 'K', 'M', 'N', 'F', 'P', 'Z', 'B', 'H', 'J'] as const).map((c) => <option key={c} value={c}>{c} · {t(`payroll.roeReasons.${c}`)}</option>)}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('payroll.filing.lastDay')} hint={t('payroll.filing.lastDayHint')}>{(p) => <Input {...p} name="lastDay" type="date" />}</Field>
                    <Field label={t('payroll.filing.recall')}>
                      {(p) => (
                        <Select {...p} value={recall} onChange={(e) => setRecall(e.target.value as 'Y' | 'N' | 'U')}>
                          <option value="U">{t('payroll.filing.recallU')}</option>
                          <option value="Y">{t('payroll.filing.recallY')}</option>
                          <option value="N">{t('payroll.filing.recallN')}</option>
                        </Select>
                      )}
                    </Field>
                    {recall === 'Y' ? <Field label={t('payroll.filing.recallDate')}>{(p) => <Input {...p} name="recallDate" type="date" required />}</Field> : <Field label={t('payroll.filing.occupation')}>{(p) => <Input {...p} name="occupation" maxLength={40} />}</Field>}
                  </div>
                  <Field label={t('payroll.filing.comments')}>{(p) => <Input {...p} name="comments" maxLength={160} />}</Field>
                  {problemList('roe')}
                  <div><Button type="submit" size="sm" icon={<FileDown className="h-4 w-4" aria-hidden="true" />} loading={busy === 'roe'}>{t('payroll.filing.roeXml')}</Button></div>
                  <p className="text-caption text-muted">{t('payroll.filing.roeHint')}</p>
                </form>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
