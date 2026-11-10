'use client';

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Plus, RefreshCw, Send, ShieldCheck, Wallet } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RunAdjustments } from './PayrollExtras';
import { StatementView } from '@/components/payroll/StatementView';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, apiDownload, saveBlob } from '@/lib/api';
import type { Departments } from '@/lib/departments';
import { formatDate, formatMoney } from '@/lib/format';
import { type Run, STATUS_TONE, type Statement } from '@/lib/payroll';
import { useSession } from '@/lib/session';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';
import { issueKey, issueLabel } from '@/lib/payrollIssues';

interface RunDetail {
  run: Run;
  transmissions: Array<{ id: string; at: string; fileName: string; status: 'SENT' | 'FAILED'; error: string | null; encrypted: boolean }>;
  departments: Array<{ id: string; name: string; nameFr: string | null }>;
  byDepartment: Array<{ departmentId: string | null; people: number; gross: number; net: number; employerCost: number }>;
  statements: Array<{ id: string; name: string; employeeNumber: string | null; province: string; hours: number; gross: number; totalDeductions: number; net: number; deposit: string | null; deductions: { cpp: number; cpp2: number; ei: number; federalTax: number; provincialTax: number } }>;
}

export function PayRuns() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const runs = useQuery<Run[]>('/api/payroll/runs');
  const depts = useQuery<Departments>('/api/departments');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const deptName = (id: string | null) => {
    if (!id) return t('payroll.allDepartments');
    const d = depts.data?.departments.find((x) => x.id === id);
    return d ? (lng === 'fr-CA' && d.nameFr ? d.nameFr : d.name) : '—';
  };
  if (!runs.data) return <Skeleton className="h-64" />;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('payroll.runs')} description={t('payroll.runsHelp')} action={<Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setCreating(true)}>{t('payroll.newRun')}</Button>} />
        <CardBody className="pt-2">
          {!runs.data.length ? (
            <EmptyState icon={Wallet} title={t('payroll.noRuns')}>{t('payroll.noRunsHelp')}</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-small tabular-nums">
                <thead className="text-left text-caption text-muted">
                  <tr><th className="py-2 font-semibold">{t('payroll.periodLabel')}</th><th className="py-2 font-semibold">{t('payroll.department')}</th><th className="py-2 font-semibold">{t('payroll.payDate')}</th><th className="py-2 font-semibold">{t('payroll.status')}</th><th className="py-2 text-right font-semibold">{t('payroll.people')}</th><th className="py-2 text-right font-semibold">{t('payroll.gross')}</th><th className="py-2 text-right font-semibold">{t('payroll.net')}</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {runs.data.map((r) => (
                    <tr key={r.id} className="cursor-pointer hover:bg-surface" onClick={() => setOpen(r.id)}>
                      <td className="py-2.5"><button type="button" className="font-semibold hover:underline" onClick={() => setOpen(r.id)}>{formatDate(r.periodStart, lng)} – {formatDate(r.periodEnd, lng)}</button></td>
                      <td className="py-2.5">{deptName(r.departmentId)}</td>
                      <td className="py-2.5">{formatDate(r.payDate, lng, 'dated')}</td>
                      <td className="py-2.5"><StatusPill tone={STATUS_TONE[r.status]}>{t(`payroll.statuses.${r.status}`)}</StatusPill>{r.blockers.length && r.status === 'DRAFT' ? <AlertTriangle className="ml-1 inline h-4 w-4 text-warn" aria-label={t('payroll.hasBlockers')} /> : null}</td>
                      <td className="py-2.5 text-right">{r.totals.people ?? 0}</td>
                      <td className="py-2.5 text-right">{formatMoney(r.totals.gross ?? 0, lng)}</td>
                      <td className="py-2.5 text-right">{formatMoney(r.totals.net ?? 0, lng)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      {creating ? <NewRun departments={depts.data} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await runs.reload(); setOpen(id); }} /> : null}
      {open ? <RunPanel id={open} deptName={deptName} onClose={() => setOpen(null)} onChanged={runs.reload} /> : null}
    </div>
  );
}

/** The most recent full two-week period, starting on the city's pay-week day (0 = Sunday). */
function lastPeriodStart(weekStart: number) {
  const today = todayIso();
  const back = (new Date(`${today}T12:00:00Z`).getUTCDay() - weekStart + 7) % 7;
  return plusDays(today, -back - 14);
}

function NewRun({ departments, onClose, onCreated }: { departments: Departments | null; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [offCycle, setOffCycle] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('new', () => api<Run>('/api/payroll/runs', { method: 'POST', body: { departmentId: String(f.get('department')) || null, periodStart: String(f.get('start')), weeks: Number(f.get('weeks')), payDate: String(f.get('payDate')), kind: String(f.get('kind') || 'REGULAR'), note: String(f.get('note') ?? '').trim() || null } }), t('payroll.runCreated'));
    if (r) await onCreated(r.id);
  }
  const weekStart = useQuery<{ payWeekStartDay: number }>('/api/payroll/settings').data?.payWeekStartDay ?? 0;
  const start = lastPeriodStart(weekStart);
  return (
    <Dialog open onClose={onClose} title={t('payroll.newRun')} description={t('payroll.newRunHelp')}>
      <form key={weekStart} onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t('payroll.runKind')} hint={t('payroll.runKindHint')}>
          {(p) => (
            <Select {...p} name="kind" defaultValue="REGULAR" onChange={(e) => setOffCycle(e.target.value === 'OFF_CYCLE')}>
              <option value="REGULAR">{t('payroll.kinds.REGULAR')}</option>
              <option value="OFF_CYCLE">{t('payroll.kinds.OFF_CYCLE')}</option>
            </Select>
          )}
        </Field>
        {offCycle ? <Field label={t('payroll.runNote')}>{(p) => <Input {...p} name="note" maxLength={200} placeholder={t('payroll.runNotePlaceholder')} />}</Field> : null}
        <Field label={t('payroll.department')}>
          {(p) => (
            <Select {...p} name="department" defaultValue="">
              <option value="">{t('payroll.allDepartments')}</option>
              {(departments?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{i18n.language === 'fr-CA' && d.nameFr ? d.nameFr : d.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('payroll.start')}>{(p) => <Input {...p} name="start" type="date" required defaultValue={start} />}</Field>
          <Field label={t('payroll.length')}>
            {(p) => (
              <Select {...p} name="weeks" defaultValue="2">
                <option value="1">{t('payroll.weeks', { count: 1 })}</option>
                <option value="2">{t('payroll.weeks', { count: 2 })}</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('payroll.payDate')}>{(p) => <Input {...p} name="payDate" type="date" required defaultValue={plusDays(start, 18)} />}</Field>
        <div className="flex gap-2"><Button type="submit" loading={busy === 'new'}>{t('payroll.calculate')}</Button><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button></div>
      </form>
    </Dialog>
  );
}

function RunPanel({ id, deptName, onClose, onChanged }: { id: string; deptName: (id: string | null) => string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can, me } = useSession();
  const toast = useToast();
  const { run, busy } = useAction();
  const data = useQuery<RunDetail>(`/api/payroll/runs/${id}`);
  const settings = useQuery<{ twoPersonApproval: boolean; bank: { configured: boolean; autoSend?: boolean } }>('/api/payroll/settings');
  const [statement, setStatement] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const st = useQuery<Statement>(statement ? `/api/payroll/statements/${statement}` : null);
  const money = (n: number) => formatMoney(n, lng);
  const refresh = async () => {
    await data.reload();
    await onChanged();
  };
  async function act(key: string, path: string, success: string, body?: object) {
    const r = await run(key, () => api<{ transmission?: { status: string; error?: string } | null }>(path, { method: 'POST', body }), success);
    if (r?.transmission) toast(r.transmission.status === 'SENT' ? t('payroll.bank.sent') : t('payroll.bank.autoFailed', { error: r.transmission.error ?? '' }), r.transmission.status === 'SENT' ? 'ok' : 'warn');
    if (r !== undefined) await refresh();
    return r;
  }
  async function sendToBank() {
    try {
      const r = await api<{ status: string; late?: boolean }>(`/api/payroll/runs/${id}/send`, { method: 'POST' });
      toast(r.late ? t('payroll.bank.sentLate') : t('payroll.bank.sent'), r.late ? 'warn' : 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    }
    await refresh();
  }
  async function download(path: string, fallback: string, key: string) {
    const r = await apiDownload(path);
    if (r.ok) {
      const name = /filename="?([^";]+)"?/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback;
      saveBlob(r.blob, name);
      if (key === 'deposit') toast(t('payroll.depositSaved'), 'ok');
      await refresh();
    } else toast(t(`errors.${String(r.error.code)}`, { defaultValue: String(r.error.message ?? t('common.error')) }), 'warn');
  }
  const d = data.data;
  return (
    <Dialog open onClose={onClose} title={d ? `${formatDate(d.run.periodStart, lng)} – ${formatDate(d.run.periodEnd, lng)} · ${deptName(d.run.departmentId)}` : t('payroll.run')}>
      {!d ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_TONE[d.run.status]}>{t(`payroll.statuses.${d.run.status}`)}</StatusPill>
            {d.run.kind === 'OFF_CYCLE' ? <StatusPill tone="new">{t('payroll.kinds.OFF_CYCLE')}</StatusPill> : null}
            <span className="text-small text-muted">{t('payroll.payOn', { date: formatDate(d.run.payDate, lng, 'dated') })}{d.run.note ? ` · ${d.run.note}` : ''}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['gross', 'deductions', 'net'] as const).map((k) => (
              <div key={k} className="rounded-xl bg-surface p-3"><dt className="text-caption text-muted">{t(`payroll.totals.${k}`)}</dt><dd className="text-body-strong tabular-nums">{money(d.run.totals[k] ?? 0)}</dd></div>
            ))}
            <div className="rounded-xl bg-surface p-3"><dt className="text-caption text-muted">{t('payroll.totals.employer')}</dt><dd className="text-body-strong tabular-nums">{money((d.run.totals.employerCpp ?? 0) + (d.run.totals.employerEi ?? 0) + (d.run.totals.employerQpip ?? 0))}</dd></div>
          </dl>
          {!me?.scoped ? <RunAdjustments runId={id} draft={d.run.status === 'DRAFT'} onChanged={refresh} /> : null}
          {d.run.status === 'DRAFT' && d.run.blockers.length ? (
            <div className="rounded-2xl border border-danger/40 bg-danger/5 p-4">
              <p className="mb-2 flex items-center gap-2 text-body-strong"><AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />{t('payroll.blockers')}</p>
              <ul className="list-disc space-y-1 pl-5 text-small">{d.run.blockers.map((b) => <li key={issueKey(b)}>{issueLabel(t, b)}</li>)}</ul>
            </div>
          ) : null}
          {d.run.warnings.length ? (
            <details className="rounded-2xl border border-line p-4 text-small">
              <summary className="cursor-pointer font-semibold">{t('payroll.warningsCount', { count: d.run.warnings.length })}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">{d.run.warnings.map((w) => <li key={issueKey(w)}>{issueLabel(t, w)}</li>)}</ul>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {d.run.status === 'DRAFT' ? <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} loading={busy === 'recalc'} onClick={() => void act('recalc', `/api/payroll/runs/${id}/recalculate`, t('payroll.recalculated'))}>{t('payroll.recalculate')}</Button> : null}
            {d.run.status === 'DRAFT' && can('payroll.approve') ? (
              <Button size="sm" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} disabled={!!d.run.blockers.length} loading={busy === 'approve'} onClick={() => void act('approve', `/api/payroll/runs/${id}/approve`, t('payroll.approved'))}>
                {t('payroll.approve')}
              </Button>
            ) : null}
            {(d.run.status === 'APPROVED' || d.run.status === 'PAID') && can('payroll.approve') && settings.data?.bank.configured && !d.transmissions.some((x) => x.status === 'SENT') ? (
              <Button size="sm" icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={busy === 'send'} onClick={() => void sendToBank()}>{t('payroll.bank.send')}</Button>
            ) : null}
            {(d.run.status === 'APPROVED' || d.run.status === 'PAID') && can('payroll.approve') ? <Button size="sm" variant={settings.data?.bank.configured ? 'secondary' : 'primary'} icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void download(`/api/payroll/runs/${id}/deposit-file`, 'deposit.txt', 'deposit')}>{t('payroll.depositFile')}</Button> : null}
            <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" aria-hidden="true" />} onClick={() => void download(`/api/payroll/runs/${id}/register.csv`, 'payroll-register.csv', 'register')}>{t('payroll.register')}</Button>
            {d.run.status === 'APPROVED' && can('payroll.approve') ? <Button size="sm" variant="secondary" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'paid'} onClick={() => void act('paid', `/api/payroll/runs/${id}/paid`, t('payroll.markedPaid'))}>{t('payroll.markPaid')}</Button> : null}
            {(d.run.status === 'DRAFT' || d.run.status === 'APPROVED') && can('payroll.approve') ? <Button size="sm" variant="ghost" onClick={() => setVoiding(true)}>{t('payroll.void')}</Button> : null}
          </div>
          {d.run.status === 'DRAFT' && d.run.preparedById === me?.id && settings.data?.twoPersonApproval !== false ? <p className="text-caption text-muted">{t('payroll.secondPerson')}</p> : null}
          {d.transmissions.length ? (
            <ul className="grid gap-1 text-small">
              {d.transmissions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={x.status === 'SENT' ? 'ok' : 'danger'}>{t(`payroll.bank.status.${x.status}`)}</StatusPill>
                  <span className="text-muted">{new Date(x.at).toLocaleString(lng)} · {x.fileName}{x.encrypted ? ` · ${t('payroll.bank.pgpShort')}` : ''}</span>
                  {x.error ? <span className="basis-full text-caption text-danger">{x.error}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {d.run.depositFileSha256 ? <p className="break-all text-caption text-muted">{t('payroll.fileRecord', { number: String(d.run.fileCreationNumber).padStart(4, '0'), hash: d.run.depositFileSha256.slice(0, 16) })}</p> : null}
          {voiding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const reason = String(new FormData(e.currentTarget).get('reason'));
                void act('void', `/api/payroll/runs/${id}/void`, t('payroll.voided'), { reason }).then((r) => r !== undefined && setVoiding(false));
              }}
              className="grid gap-3 rounded-2xl border border-line p-4"
            >
              <Field label={t('payroll.voidReason')}>{(p) => <Textarea {...p} name="reason" required minLength={5} rows={2} />}</Field>
              <div className="flex gap-2"><Button type="submit" size="sm" variant="danger" loading={busy === 'void'}>{t('payroll.void')}</Button><Button size="sm" variant="ghost" onClick={() => setVoiding(false)}>{t('common.cancel')}</Button></div>
            </form>
          ) : null}
          {d.byDepartment.length > 1 || d.run.departmentId === null ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-small tabular-nums">
                <thead className="text-left text-caption text-muted"><tr><th className="py-1.5 font-semibold">{t('payroll.department')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.people')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.gross')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.employerCost')}</th></tr></thead>
                <tbody className="divide-y divide-line">{d.byDepartment.map((b) => <tr key={b.departmentId ?? 'none'}><td className="py-1.5">{b.departmentId ? deptName(b.departmentId) : t('departments.none')}</td><td className="py-1.5 text-right">{b.people}</td><td className="py-1.5 text-right">{money(b.gross)}</td><td className="py-1.5 text-right">{money(b.employerCost)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-small tabular-nums">
              <thead className="text-left text-caption text-muted">
                <tr><th className="py-1.5 font-semibold">{t('payroll.employee')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.hours')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.gross')}</th><th className="py-1.5 text-right font-semibold">CPP</th><th className="py-1.5 text-right font-semibold">EI</th><th className="py-1.5 text-right font-semibold">{t('payroll.tax')}</th><th className="py-1.5 text-right font-semibold">{t('payroll.net')}</th><th className="py-1.5 font-semibold">{t('payroll.paidTo')}</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.statements.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2"><button type="button" className="font-semibold hover:underline" onClick={() => setStatement(s.id)}>{s.name}</button></td>
                    <td className="py-2 text-right">{s.hours}</td>
                    <td className="py-2 text-right">{money(s.gross)}</td>
                    <td className="py-2 text-right">{money(s.deductions.cpp + s.deductions.cpp2)}</td>
                    <td className="py-2 text-right">{money(s.deductions.ei)}</td>
                    <td className="py-2 text-right">{money(s.deductions.federalTax + s.deductions.provincialTax)}</td>
                    <td className="py-2 text-right font-semibold">{money(s.net)}</td>
                    <td className="py-2">{s.deposit ?? t('payroll.byCheque')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {statement ? (
            <div className="rounded-2xl border border-line p-4">
              {st.data ? <StatementView s={st.data} /> : <Skeleton className="h-48" />}
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => setStatement(null)}>{t('common.close')}</Button>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
