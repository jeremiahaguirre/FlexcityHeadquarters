'use client';

import { Gavel, Plus, Trash2, Wallet } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { todayIso, useQuery } from '@/lib/useQuery';

const KINDS = ['BONUS', 'RETRO', 'VACATION_PAYOUT', 'LIEU_PAYOUT', 'ALLOWANCE', 'OTHER_EARNING', 'REIMBURSEMENT', 'RECOVERY', 'OTHER_DEDUCTION'] as const;
const ORDER_KINDS = ['SUPPORT_ORDER', 'GARNISHMENT', 'CRA_REQUIREMENT', 'OTHER'] as const;

function useRun() {
  const toast = useToast();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast(ok, 'ok');
      return r ?? true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

/** One-time payments and deductions on a draft run: bonus, retro pay, reimbursement, recovery… */
export function RunAdjustments({ runId, draft, onChanged }: { runId: string; draft: boolean; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const money = (n: number) => formatMoney(n, i18n.language);
  const list = useQuery<Array<{ id: string; userId: string; kind: (typeof KINDS)[number]; description: string; amount: number; hours?: number | null }>>(`/api/payroll/runs/${runId}/adjustments`);
  const people = useQuery<{ people: Array<{ id: string; name: string }> }>(draft ? '/api/payroll/people' : null);
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('BONUS');
  const name = (id: string) => people.data?.people.find((p) => p.id === id)?.name ?? '';
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await run('add', () => api(`/api/payroll/runs/${runId}/adjustments`, { method: 'POST', body: { userId: String(f.get('userId')), kind, description: String(f.get('description')).trim(), ...(kind === 'LIEU_PAYOUT' ? { hours: Number(f.get('hours')) } : { amount: Number(f.get('amount')) }) } }), t('payroll.extras.added'));
    if (ok) {
      setOpen(false);
      await list.reload();
      await onChanged();
    }
  }
  if (!draft && !list.data?.length) return null;
  return (
    <section className="grid gap-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body-strong"><Wallet className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('payroll.extras.title')}</h3>
        {draft ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{t('payroll.extras.add')}</Button> : null}
      </div>
      <p className="text-caption text-muted">{t('payroll.extras.help')}</p>
      {open ? (
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('payroll.employee')}>{(p) => <Select {...p} name="userId" required>{people.data?.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <Field label={t('payroll.extras.kind')}>{(p) => <Select {...p} name="kind" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>{KINDS.map((k) => <option key={k} value={k}>{t(`payroll.extras.kinds.${k}`)}</option>)}</Select>}</Field>
          <Field label={t('payroll.extras.description')}>{(p) => <Input {...p} name="description" required minLength={2} maxLength={120} />}</Field>
          {kind === 'LIEU_PAYOUT' ? (
            <Field label={t('lieu.payoutHours')} hint={t('lieu.payoutHoursHint')}>{(p) => <Input {...p} name="hours" type="number" min={0.25} step={0.25} required inputMode="decimal" />}</Field>
          ) : (
            <Field label={t('payroll.extras.amount')}>{(p) => <Input {...p} name="amount" type="number" min={0.01} step={0.01} required inputMode="decimal" />}</Field>
          )}
          <div className="sm:col-span-2"><Button type="submit" size="sm" loading={busy === 'add'}>{t('payroll.extras.save')}</Button></div>
        </form>
      ) : null}
      {list.data?.length ? (
        <ul className="divide-y divide-line text-small">
          {list.data.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="font-semibold">{name(x.userId) || t('payroll.employee')}</span> · {t(`payroll.extras.kinds.${x.kind}`)} · {x.description}{x.hours ? ` · ${t('lieu.hours', { n: x.hours })}` : ''}</span>
              <span className="tabular-nums">{['RECOVERY', 'OTHER_DEDUCTION'].includes(x.kind) ? '−' : ''}{money(x.amount)}</span>
              {draft ? <Button size="sm" variant="ghost" aria-label={t('payroll.extras.remove', { what: x.description })} loading={busy === x.id} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(x.id, async () => { await api(`/api/payroll/runs/${runId}/adjustments/${x.id}`, { method: 'DELETE' }); await list.reload(); await onChanged(); })} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A salaried person's annual salary (paid evenly each period), or back to hourly. */
export function SalaryEditor({ userId, canChange }: { userId: string; canChange: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const list = useQuery<Array<{ id: string; positionId: string; annualAmount: number; weeklyHours: number; overtimeEligible: boolean; effectiveFrom: string; effectiveTo: string | null }>>(`/api/users/${userId}/salary`);
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const { run, busy } = useRun();
  const current = list.data?.find((s) => !s.effectiveTo || s.effectiveTo >= todayIso());
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run('salary', () => api(`/api/users/${userId}/salary`, { method: 'POST', body: { positionId: String(f.get('positionId')), annualAmount: Number(f.get('annual')), weeklyHours: Number(f.get('weekly') || 37.5), overtimeEligible: f.get('ot') === 'on', effectiveFrom: String(f.get('from')) } }), t('payroll.salary.saved'))) await list.reload();
  }
  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-3 border-t border-line pt-5">
      <h3 className="text-body-strong">{t('payroll.salary.title')}</h3>
      <p className="text-caption text-muted">{current ? t('payroll.salary.current', { amount: formatMoney(current.annualAmount, lng), from: formatDate(current.effectiveFrom, lng) }) : t('payroll.salary.hourly')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('payroll.salary.annual')}>{(p) => <Input {...p} name="annual" type="number" min={1} step={0.01} required defaultValue={current?.annualAmount ?? ''} />}</Field>
        <Field label={t('payroll.salary.position')}>{(p) => <Select {...p} name="positionId" required defaultValue={current?.positionId}>{positions.data?.map((x) => <option key={x.id} value={x.id}>{lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name}</option>)}</Select>}</Field>
        <Field label={t('payroll.salary.weekly')}>{(p) => <Input {...p} name="weekly" type="number" min={1} max={80} step={0.5} defaultValue={current?.weeklyHours ?? 37.5} />}</Field>
        <Field label={t('payroll.salary.from')}>{(p) => <Input {...p} name="from" type="date" required defaultValue={todayIso()} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-small"><input type="checkbox" name="ot" defaultChecked={current?.overtimeEligible} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('payroll.salary.overtime')}</label>
      <div className={canChange ? 'flex flex-wrap gap-2' : 'hidden'}>
        <Button type="submit" size="sm" loading={busy === 'salary'}>{t('payroll.salary.save')}</Button>
        {current ? <Button size="sm" variant="ghost" loading={busy === 'end'} onClick={() => void run('end', async () => { await api(`/api/users/${userId}/salary/end`, { method: 'POST', body: { lastDay: todayIso() } }); await list.reload(); }, t('payroll.salary.ended'))}>{t('payroll.salary.end')}</Button> : null}
      </div>
    </form>
  );
}

/** Court-ordered and CRA deductions: taken each pay, never over their share of net, until paid. */
export function OrdersEditor({ userId, canChange }: { userId: string; canChange: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (n: number) => formatMoney(n, lng);
  const list = useQuery<Array<{ id: string; kind: (typeof ORDER_KINDS)[number]; payee: string; reference: string | null; amountPerPay: number | null; percentOfNet: number | null; maxPercentOfNet: number; totalOwed: number | null; collected: number; startsOn: string; endsOn: string | null }>>(`/api/users/${userId}/payroll-orders`);
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState<'amount' | 'percent'>('amount');
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => (String(f.get(k) ?? '').trim() ? Number(f.get(k)) : null);
    const ok = await run('order', () => api(`/api/users/${userId}/payroll-orders`, { method: 'POST', body: { kind: String(f.get('kind')), payee: String(f.get('payee')).trim(), reference: String(f.get('reference') ?? '').trim() || null, amountPerPay: by === 'amount' ? n('value') : null, percentOfNet: by === 'percent' ? n('value') : null, maxPercentOfNet: n('max') ?? 50, totalOwed: n('total'), startsOn: String(f.get('starts')) } }), t('payroll.orders.added'));
    if (ok) {
      setOpen(false);
      await list.reload();
    }
  }
  return (
    <section className="grid gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body-strong"><Gavel className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('payroll.orders.title')}</h3>
        {canChange ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{t('payroll.orders.add')}</Button> : null}
      </div>
      <p className="text-caption text-muted">{t('payroll.orders.help')}</p>
      {open ? (
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('payroll.orders.kind')}>{(p) => <Select {...p} name="kind">{ORDER_KINDS.map((k) => <option key={k} value={k}>{t(`payroll.orders.kinds.${k}`)}</option>)}</Select>}</Field>
          <Field label={t('payroll.orders.payee')}>{(p) => <Input {...p} name="payee" required minLength={2} maxLength={120} />}</Field>
          <Field label={t('payroll.orders.reference')}>{(p) => <Input {...p} name="reference" maxLength={60} />}</Field>
          <Field label={t('payroll.orders.by')}>{(p) => <Select {...p} value={by} onChange={(e) => setBy(e.target.value as 'amount' | 'percent')}><option value="amount">{t('payroll.orders.byAmount')}</option><option value="percent">{t('payroll.orders.byPercent')}</option></Select>}</Field>
          <Field label={by === 'amount' ? t('payroll.orders.amount') : t('payroll.orders.percent')}>{(p) => <Input {...p} name="value" type="number" min={0.01} step={0.01} max={by === 'percent' ? 100 : undefined} required />}</Field>
          <Field label={t('payroll.orders.max')} hint={t('payroll.orders.maxHint')}>{(p) => <Input {...p} name="max" type="number" min={1} max={100} defaultValue={50} />}</Field>
          <Field label={t('payroll.orders.total')} hint={t('payroll.orders.totalHint')}>{(p) => <Input {...p} name="total" type="number" min={0.01} step={0.01} />}</Field>
          <Field label={t('payroll.orders.starts')}>{(p) => <Input {...p} name="starts" type="date" required defaultValue={todayIso()} />}</Field>
          <div className="sm:col-span-2"><Button type="submit" size="sm" loading={busy === 'order'}>{t('payroll.orders.save')}</Button></div>
        </form>
      ) : null}
      {list.data?.length ? (
        <ul className="divide-y divide-line text-small">
          {list.data.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t(`payroll.orders.kinds.${o.kind}`)} · {o.payee}{o.reference ? ` · ${o.reference}` : ''}</p>
                <p className="text-caption text-muted">
                  {o.amountPerPay != null ? t('payroll.orders.eachPay', { amount: money(o.amountPerPay) }) : t('payroll.orders.ofNet', { percent: o.percentOfNet })} · {t('payroll.orders.collected', { amount: money(o.collected) })}{o.totalOwed != null ? ` / ${money(o.totalOwed)}` : ''}{o.endsOn ? ` · ${t('payroll.orders.ended', { date: formatDate(o.endsOn, lng) })}` : ''}
                </p>
              </div>
              {!o.endsOn && canChange ? <Button size="sm" variant="ghost" loading={busy === o.id} onClick={() => void run(o.id, async () => { await api(`/api/users/${userId}/payroll-orders/${o.id}/end`, { method: 'POST', body: { endsOn: todayIso() } }); await list.reload(); })}>{t('payroll.orders.end')}</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
