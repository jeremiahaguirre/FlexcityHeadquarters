'use client';

import { Plus, Tag } from 'lucide-react';
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
import { type Fee, money } from '@/lib/programs';
import { useAction, useQuery } from '@/lib/useQuery';

const KINDS = ['MEMBERSHIP', 'PASS', 'DROP_IN', 'PROGRAM'] as const;
const GROUPS = ['ALL', 'ADULT', 'YOUTH', 'CHILD', 'SENIOR', 'STUDENT', 'FAMILY'] as const;
const PERIOD_FOR: Record<Fee['kind'], Fee['period']> = { MEMBERSHIP: 'YEAR', PASS: 'NONE', DROP_IN: 'VISIT', PROGRAM: 'NONE' };

/** The facility price list: memberships by year or month, drop-ins, passes and programs. */
export default function FeesPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Fee[]>('/api/fees');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Fee | 'new' | null>(null);
  const [kind, setKind] = useState<Fee['kind']>('MEMBERSHIP');
  const current = editing === 'new' ? null : editing;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = {
      kind, period: kind === 'MEMBERSHIP' ? s('period') : PERIOD_FOR[kind], ageGroup: s('group'), name: s('name'), nameFr: s('nameFr') || null,
      priceCents: Math.round(Number(s('price').replace(',', '.')) * 100), visits: kind === 'PASS' && s('visits') ? Number(s('visits')) : null,
      facilityId: s('facility') || null, active: f.get('active') === 'on',
    };
    const ok = await run('fee', () => (current ? api(`/api/fees/${current.id}`, { method: 'PATCH', body }) : api('/api/fees', { method: 'POST', body })), t('fees.saved'));
    if (ok !== undefined) {
      setEditing(null);
      await q.reload();
    }
  }
  const open = (f: Fee | 'new') => {
    setKind(f === 'new' ? 'MEMBERSHIP' : f.kind);
    setEditing(f);
  };
  return (
    <div className="grid gap-6">
      <PageHeader title={t('fees.title')} description={t('fees.description')} actions={<Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => open('new')}>{t('fees.add')}</Button>} />
      {!q.data ? <Skeleton className="h-64" /> : !q.data.length ? <EmptyState icon={Tag} title={t('fees.none')}>{t('fees.noneHelp')}</EmptyState> : KINDS.filter((k) => q.data!.some((x) => x.kind === k)).map((k) => (
        <Card key={k}>
          <CardHeader title={t(`fees.kind.${k}`)} />
          <CardBody className="pt-1">
            <ul className="divide-y divide-line text-small">
              {q.data!.filter((x) => x.kind === k).map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => open(x)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg py-2.5 text-left hover:bg-surface/60">
                    <span><span className="font-semibold">{x.name}</span><span className="block text-caption text-muted">{t(`fees.group.${x.ageGroup}`)}{x.period !== 'NONE' ? ` · ${t(`fees.period.${x.period}`)}` : ''}{x.visits ? ` · ${t('fees.visitsN', { count: x.visits })}` : ''}{x.facilityId ? ` · ${facilities.data?.find((f) => f.id === x.facilityId)?.name ?? ''}` : ''}</span></span>
                    <span className="flex items-center gap-2">{!x.active ? <StatusPill tone="neutral">{t('fees.inactive')}</StatusPill> : null}<span className="text-body-strong tabular-nums">{money(x.priceCents, i18n.language)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
      <p className="text-caption text-muted">{t('fees.programsNote')}</p>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? current.name : t('fees.add')} closeLabel={t('common.cancel')}>
        <form key={current?.id ?? 'new'} className="grid gap-4" onSubmit={(e) => void save(e)}>
          <Field label={t('fees.kindLabel')}>{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as Fee['kind'])}>{KINDS.map((k) => <option key={k} value={k}>{t(`fees.kind.${k}`)}</option>)}</Select>}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fees.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} defaultValue={current?.name ?? ''} placeholder={t('fees.namePlaceholder')} />}</Field>
            <Field label={t('fees.nameFr')} hint={t('common.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={80} defaultValue={current?.nameFr ?? ''} />}</Field>
            <Field label={t('fees.groupLabel')}>{(p) => <Select {...p} name="group" defaultValue={current?.ageGroup ?? 'ADULT'}>{GROUPS.map((g) => <option key={g} value={g}>{t(`fees.group.${g}`)}</option>)}</Select>}</Field>
            {kind === 'MEMBERSHIP' ? <Field label={t('fees.periodLabel')}>{(p) => <Select {...p} name="period" defaultValue={current?.period ?? 'YEAR'}><option value="YEAR">{t('fees.period.YEAR')}</option><option value="MONTH">{t('fees.period.MONTH')}</option></Select>}</Field> : kind === 'PASS' ? <Field label={t('fees.visits')}>{(p) => <Input {...p} name="visits" type="number" min={1} max={200} defaultValue={current?.visits ?? 10} />}</Field> : <div />}
            <Field label={t('fees.price')}>{(p) => <Input {...p} name="price" inputMode="decimal" required defaultValue={current ? (current.priceCents / 100).toFixed(2) : ''} />}</Field>
            <Field label={t('fees.facility')}>{(p) => <Select {...p} name="facility" defaultValue={current?.facilityId ?? ''}><option value="">{t('fees.allFacilities')}</option>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
          </div>
          <label className="flex items-center gap-2 text-small"><input type="checkbox" name="active" defaultChecked={current?.active ?? true} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('fees.activeLabel')}</label>
          <Button type="submit" loading={busy === 'fee'} className="justify-self-start">{t('common.save')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
