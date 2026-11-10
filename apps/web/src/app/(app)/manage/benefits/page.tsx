'use client';

import { HeartPulse, Plus, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { todayIso, useAction, useQuery } from '@/lib/useQuery';

const KINDS = ['PENSION', 'HEALTH', 'DENTAL', 'LIFE', 'DISABILITY', 'UNION_DUES', 'EAP', 'OTHER'] as const;
interface Plan { id: string; name: string; nameFr: string | null; kind: (typeof KINDS)[number]; provider: string | null; employeePercent: number; employeeAmount: number; employerPercent: number; employerAmount: number; employerTaxable: boolean; active: boolean; enrolled: number }
interface Enrollment { id: string; planId: string; userId: string; name: string; startsOn: string; endsOn: string | null; coverage: string | null; employeeAmount: number | null }

/** Benefits administration: plans the city offers and who is enrolled. Pay runs apply them automatically. */
export default function BenefitsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ plans: Plan[]; enrollments: Enrollment[] }>('/api/benefits');
  const people = useQuery<Array<{ id: string; name: string }>>('/api/users');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [enrolling, setEnrolling] = useState<Plan | null>(null);
  const { run, busy } = useAction();
  const share = (pct: number, amt: number) => [pct ? `${pct}%` : '', amt ? formatMoney(amt, lng) : ''].filter(Boolean).join(' + ') || '—';
  const name = (p: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);
  async function end(e: Enrollment) {
    const r = await run(`end-${e.id}`, () => api(`/api/benefits/enrollments/${e.id}/end`, { method: 'POST', body: { endsOn: todayIso() } }), t('benefits.ended'));
    if (r !== undefined) await data.reload();
  }
  return (
    <div className="grid gap-6">
      <PageHeader title={t('benefits.title')} description={t('benefits.description')} actions={<Button icon={<Plus className="h-5 w-5" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('benefits.addPlan')}</Button>} />
      {!data.data ? (
        <Skeleton className="h-64" />
      ) : !data.data.plans.length ? (
        <EmptyState icon={HeartPulse} title={t('benefits.none')}>{t('benefits.noneHelp')}</EmptyState>
      ) : (
        data.data.plans.map((p) => {
          const members = data.data!.enrollments.filter((e) => e.planId === p.id && (!e.endsOn || e.endsOn >= todayIso()));
          return (
            <Card key={p.id}>
              <CardHeader
                title={<span className="flex flex-wrap items-center gap-2">{name(p)}<StatusPill tone="brand">{t(`benefits.kinds.${p.kind}`)}</StatusPill>{!p.active ? <StatusPill tone="neutral">{t('benefits.inactive')}</StatusPill> : null}</span>}
                description={`${p.provider ? `${p.provider} · ` : ''}${t('benefits.shares', { employee: share(p.employeePercent, p.employeeAmount), employer: share(p.employerPercent, p.employerAmount) })}${p.employerTaxable ? ` · ${t('benefits.taxableShort')}` : ''}`}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEnrolling(p)}>{t('benefits.enroll')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>{t('common.edit')}</Button>
                  </div>
                }
              />
              <CardBody className="pt-2">
                {!members.length ? (
                  <p className="text-small text-muted">{t('benefits.nobody')}</p>
                ) : (
                  <ul className="divide-y divide-line text-small">
                    {members.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span><span className="font-semibold">{e.name}</span><span className="text-muted"> · {t('benefits.since', { date: formatDate(e.startsOn, lng, 'dated') })}{e.coverage ? ` · ${e.coverage}` : ''}{e.employeeAmount != null ? ` · ${formatMoney(e.employeeAmount, lng)}` : ''}</span></span>
                        <Button size="sm" variant="ghost" loading={busy === `end-${e.id}`} onClick={() => void end(e)}>{t('benefits.end')}</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })
      )}
      {editing ? <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await data.reload(); }} /> : null}
      {enrolling ? <EnrollForm plan={enrolling} people={people.data ?? []} onClose={() => setEnrolling(null)} onSaved={async () => { setEnrolling(null); await data.reload(); }} /> : null}
    </div>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k) || 0);
    const body = { name: String(f.get('name')).trim(), nameFr: String(f.get('nameFr') ?? '').trim() || null, kind: String(f.get('kind')), provider: String(f.get('provider') ?? '').trim() || null, employeePercent: n('ep'), employeeAmount: n('ea'), employerPercent: n('rp'), employerAmount: n('ra'), employerTaxable: f.get('taxable') === 'on', active: f.get('active') === 'on' };
    const r = await run('plan', () => api(plan ? `/api/benefits/plans/${plan.id}` : '/api/benefits/plans', { method: plan ? 'PUT' : 'POST', body }), t('benefits.saved'));
    if (r !== undefined) await onSaved();
  }
  return (
    <Dialog open onClose={onClose} title={plan ? plan.name : t('benefits.addPlan')}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('benefits.name')}>{(p) => <Input {...p} name="name" required minLength={2} defaultValue={plan?.name ?? ''} />}</Field>
          <Field label={t('benefits.nameFr')}>{(p) => <Input {...p} name="nameFr" defaultValue={plan?.nameFr ?? ''} />}</Field>
          <Field label={t('benefits.kind')} hint={t('benefits.kindHint')}>{(p) => <Select {...p} name="kind" defaultValue={plan?.kind ?? 'HEALTH'}>{KINDS.map((k) => <option key={k} value={k}>{t(`benefits.kinds.${k}`)}</option>)}</Select>}</Field>
          <Field label={t('benefits.provider')}>{(p) => <Input {...p} name="provider" defaultValue={plan?.provider ?? ''} />}</Field>
        </div>
        <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-small font-semibold">{t('benefits.perPay')}</legend>
          <Field label={t('benefits.employeePercent')}>{(p) => <Input {...p} name="ep" type="number" min={0} max={100} step="0.001" defaultValue={plan?.employeePercent || ''} />}</Field>
          <Field label={t('benefits.employeeAmount')}>{(p) => <Input {...p} name="ea" type="number" min={0} step="0.01" defaultValue={plan?.employeeAmount || ''} />}</Field>
          <Field label={t('benefits.employerPercent')}>{(p) => <Input {...p} name="rp" type="number" min={0} max={100} step="0.001" defaultValue={plan?.employerPercent || ''} />}</Field>
          <Field label={t('benefits.employerAmount')}>{(p) => <Input {...p} name="ra" type="number" min={0} step="0.01" defaultValue={plan?.employerAmount || ''} />}</Field>
        </fieldset>
        <label className="flex items-start gap-2 text-small"><input type="checkbox" name="taxable" defaultChecked={plan?.employerTaxable ?? false} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" /><span><span className="font-semibold">{t('benefits.taxable')}</span><span className="block text-caption text-muted">{t('benefits.taxableHelp')}</span></span></label>
        <label className="flex items-center gap-2 text-small"><input type="checkbox" name="active" defaultChecked={plan?.active ?? true} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('benefits.active')}</label>
        <div className="flex gap-2"><Button type="submit" loading={busy === 'plan'}>{t('common.save')}</Button><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button></div>
      </form>
    </Dialog>
  );
}

function EnrollForm({ plan, people, onClose, onSaved }: { plan: Plan; people: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amt = String(f.get('amount') ?? '').trim();
    const r = await run('enroll', () => api('/api/benefits/enrollments', { method: 'POST', body: { planId: plan.id, userId: String(f.get('user')), startsOn: String(f.get('start')), coverage: String(f.get('coverage') ?? '').trim() || null, employeeAmount: amt ? Number(amt) : null } }), t('benefits.enrolled'));
    if (r !== undefined) await onSaved();
  }
  return (
    <Dialog open onClose={onClose} title={t('benefits.enrollIn', { plan: plan.name })}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t('payroll.employee')}>{(p) => <Select {...p} name="user" required defaultValue="">{[<option key="" value="" disabled>{t('payroll.choosePerson')}</option>, ...people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)]}</Select>}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('benefits.startsOn')}>{(p) => <Input {...p} name="start" type="date" required defaultValue={todayIso()} />}</Field>
          <Field label={t('benefits.coverage')}>{(p) => <Input {...p} name="coverage" placeholder={t('benefits.coverageHint')} />}</Field>
        </div>
        <Field label={t('benefits.overrideAmount')} hint={t('benefits.overrideHint')}>{(p) => <Input {...p} name="amount" type="number" min={0} step="0.01" />}</Field>
        <div className="flex gap-2"><Button type="submit" loading={busy === 'enroll'}>{t('benefits.enroll')}</Button><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button></div>
      </form>
    </Dialog>
  );
}
