'use client';

import { Building2, Plus, Waves } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { MultiSelect } from '@/components/ui/MultiSelect';
import type { Department, Departments } from '@/lib/departments';
import { useAction } from '@/lib/useQuery';

export interface DepartmentBody { name: string; nameFr: string | null; aquatic: boolean; positionIds: string[]; managerIds: string[] }

/**
 * Departments and the positions in each. Supervisors and managers see only their
 * departments; the built-in aquatic roles manage departments marked as aquatics.
 * Used by HR settings and by the Dev console.
 */
export function DepartmentsEditor({ data, save, remove, reload }: { data: Departments; save: (id: string | null, body: DepartmentBody) => Promise<unknown>; remove: (id: string) => Promise<unknown>; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader
        title={t('departments.title')}
        description={t('departments.help')}
        action={!adding ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('departments.add')}</Button> : undefined}
      />
      <CardBody className="grid gap-4 pt-3">
        {!data.departments.length && !adding ? (
          <EmptyState icon={Building2} title={t('departments.none_yet')}>{t('departments.noneYetHelp')}</EmptyState>
        ) : null}
        {data.departments.map((d) => (
          <DepartmentForm key={d.id} department={d} data={data} save={save} remove={remove} reload={reload} />
        ))}
        {adding ? <DepartmentForm data={data} save={save} remove={remove} reload={async () => { setAdding(false); await reload(); }} onCancel={() => setAdding(false)} /> : null}
      </CardBody>
    </Card>
  );
}

function DepartmentForm({ department, data, save, remove, reload, onCancel }: { department?: Department; data: Departments; save: (id: string | null, body: DepartmentBody) => Promise<unknown>; remove: (id: string) => Promise<unknown>; reload: () => Promise<void>; onCancel?: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [confirming, setConfirming] = useState(false);
  const name = (x: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const all = [...data.departments.flatMap((d) => d.positions.map((p) => ({ ...p, in: d }))), ...data.unassigned.map((p) => ({ ...p, in: null as Department | null }))].sort((a, b) => a.name.localeCompare(b.name));
  const key = department?.id ?? 'new';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: DepartmentBody = {
      name: String(f.get('name')).trim(),
      nameFr: String(f.get('nameFr') ?? '').trim() || null,
      aquatic: f.get('aquatic') === 'on',
      positionIds: f.getAll('positions').map(String),
      managerIds: f.getAll('managers').map(String),
    };
    const r = await run(`dept-${key}`, () => save(department?.id ?? null, body), t('departments.saved'));
    if (r !== undefined) await reload();
  }

  async function del() {
    if (!department) return;
    const r = await run(`del-${key}`, () => remove(department.id), t('departments.deleted'));
    if (r !== undefined) await reload();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4 rounded-2xl border border-line p-4 sm:p-5">
      {department ? (
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body-strong">{name(department)}</h3>
          {department.aquatic ? <StatusPill tone="brand" icon={<Waves className="h-3.5 w-3.5" aria-hidden="true" />}>{t('departments.aquaticPill')}</StatusPill> : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('departments.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={60} defaultValue={department?.name ?? ''} placeholder={t('departments.namePlaceholder')} />}</Field>
        <Field label={t('departments.nameFr')}>{(p) => <Input {...p} name="nameFr" maxLength={60} defaultValue={department?.nameFr ?? ''} />}</Field>
      </div>
      <Field label={t('departments.managers')} hint={t('departments.managersHelp')}>
        {(p) => (
          <MultiSelect
            {...p}
            name="managers"
            placeholder={t('departments.pickManagers')}
            defaultValue={department?.managerIds ?? []}
            options={(data.managerOptions ?? []).map((o) => ({
              value: o.id,
              label: o.name,
              // What makes them a manager: their built-in and custom roles.
              hint: [...o.roles.map((r) => t(`roles.${r}`)), ...o.customRoles.map((r) => name(r))].join(' · '),
            }))}
          />
        )}
      </Field>
      <Field label={t('departments.positions')} hint={!all.length ? t('departments.noPositions') : undefined}>
        {(p) => (
          <MultiSelect
            {...p}
            name="positions"
            placeholder={t('departments.pickPositions')}
            disabled={!all.length}
            defaultValue={department ? all.filter((x) => x.in?.id === department.id).map((x) => x.id) : []}
            options={all.map((x) => ({
              value: x.id,
              label: name(x),
              badge: t('departments.staffCount', { count: x.staff }),
              hint: x.in && x.in.id !== department?.id ? t('departments.movesFrom', { department: name(x.in) }) : undefined,
            }))}
          />
        )}
      </Field>
      <label className="flex items-start gap-3 text-small">
        <input type="checkbox" name="aquatic" defaultChecked={department?.aquatic ?? false} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
        <span>
          <span className="font-semibold">{t('departments.aquatic')}</span>
          <span className="block text-caption text-muted">{t('departments.aquaticHelp')}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={busy === `dept-${key}`}>{department ? t('common.save') : t('departments.create')}</Button>
        {onCancel ? <Button size="sm" variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button> : null}
        {department ? (
          confirming ? (
            <>
              <span className="text-caption text-muted">{t('departments.confirmDelete')}</span>
              <Button size="sm" variant="danger" loading={busy === `del-${key}`} onClick={() => void del()}>{t('departments.delete')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>{t('departments.delete')}</Button>
          )
        ) : null}
      </div>
    </form>
  );
}
