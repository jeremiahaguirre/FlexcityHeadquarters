'use client';

import { GraduationCap, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { todayIso, useQuery } from '@/lib/useQuery';

const KINDS = ['COURSE_FEES', 'TRAINER', 'WAGES_IN_TRAINING', 'TRAVEL', 'MATERIALS', 'OTHER'] as const;
interface Spend { id: string; spentOn: string; category: (typeof KINDS)[number]; description: string; amount: number }
export interface Skills { wsdrfSubject?: boolean; wsdrfThreshold?: number; wsdrfBeforeTraining: number; trainingSpent?: number; wsdrfOwed?: number; trainingSurplus?: number; payroll: number }

/**
 * Quebec's workforce skills law: above the payroll threshold, 1% of payroll goes to eligible
 * training or, for what's left, to the fund (WSDRF) with the RLZ-1.S. The log of eligible
 * spending, and what remains owed.
 */
export function QuebecTraining({ year, skills, onChange }: { year: number; skills: Skills; onChange: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (n: number) => formatMoney(n, lng);
  const toast = useToast();
  const list = useQuery<Spend[]>(`/api/payroll/quebec/training?year=${year}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy('add');
    try {
      await api('/api/payroll/quebec/training', { method: 'POST', body: { spentOn: String(f.get('spentOn')), category: String(f.get('category')), description: String(f.get('description')).trim(), amount: Number(f.get('amount')) } });
      toast(t('payroll.training.added'), 'ok');
      setAdding(false);
      await list.reload();
      onChange();
    } catch {
      toast(t('payroll.training.failed'), 'warn');
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`/api/payroll/quebec/training/${id}`, { method: 'DELETE' });
      await list.reload();
      onChange();
    } finally {
      setBusy(null);
    }
  }
  const owed = skills.wsdrfOwed ?? skills.wsdrfBeforeTraining;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('payroll.training.title')}</span>}
        description={t('payroll.training.help', { threshold: money(skills.wsdrfThreshold ?? 2_000_000) })}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>{t('payroll.training.add')}</Button>}
      />
      <CardBody className="grid gap-4 pt-2">
        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            [t('payroll.training.required'), skills.wsdrfSubject === false ? t('payroll.training.notSubject') : money(skills.wsdrfBeforeTraining)],
            [t('payroll.training.spent'), money(skills.trainingSpent ?? 0)],
            [t('payroll.training.owed'), money(owed)],
            [t('payroll.training.surplus'), money(skills.trainingSurplus ?? 0)],
          ].map(([k, v], i) => (
            <div key={k} className={`rounded-xl border border-line p-3 ${i === 2 && owed > 0 ? 'bg-warn/10' : ''}`}>
              <dt className="text-caption text-muted">{k}</dt>
              <dd className="text-subheading tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {adding ? (
          <form onSubmit={(e) => void add(e)} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
            <Field label={t('payroll.training.date')}>{(p) => <Input {...p} name="spentOn" type="date" required defaultValue={`${year}-${todayIso().slice(5)}`} min={`${year}-01-01`} max={`${year}-12-31`} />}</Field>
            <Field label={t('payroll.training.category')}>
              {(p) => <Select {...p} name="category" defaultValue="COURSE_FEES">{KINDS.map((k) => <option key={k} value={k}>{t(`payroll.training.kind.${k}`)}</option>)}</Select>}
            </Field>
            <Field label={t('payroll.training.description')}>{(p) => <Input {...p} name="description" required minLength={2} maxLength={200} />}</Field>
            <Field label={t('payroll.training.amount')}>{(p) => <Input {...p} name="amount" type="number" min={0.01} step={0.01} required inputMode="decimal" />}</Field>
            <Button type="submit" className="justify-self-start" loading={busy === 'add'}>{t('payroll.training.save')}</Button>
          </form>
        ) : null}
        {list.data?.length ? (
          <ul className="divide-y divide-line">
            {list.data.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{x.description}</p>
                  <p className="text-caption text-muted">{formatDate(x.spentOn, lng)} · {t(`payroll.training.kind.${x.category}`)}</p>
                </div>
                <span className="tabular-nums">{money(x.amount)}</span>
                <Button size="sm" variant="ghost" aria-label={t('payroll.training.remove', { what: x.description })} loading={busy === x.id} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void remove(x.id)} />
              </li>
            ))}
          </ul>
        ) : list.data ? <p className="text-small text-muted">{t('payroll.training.none')}</p> : null}
        <p className="text-caption text-muted">{t('payroll.training.note')}</p>
      </CardBody>
    </Card>
  );
}
