'use client';

import { Building2, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { type CustomRole, ROLE_TEMPLATES, type RoleCatalog, type RoleInput, roleName } from '@/lib/customRoles';
import { useAction } from '@/lib/useQuery';

type Named = { id: string; name: string; nameFr?: string | null };

/**
 * A city's own roles for any job: workers, leads, supervisors and managers in
 * any department. A role can be limited to a department (positions and
 * facilities). `grantable`: what this person may put in a role (undefined or
 * null = anything; the Dev console and the city's administrators).
 */
export function RoleEditor({
  roles,
  catalog,
  save,
  remove,
  reload,
  positions = [],
  facilities = [],
  grantable,
}: {
  roles: CustomRole[];
  catalog: RoleCatalog;
  save: (body: RoleInput, id?: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  reload: () => Promise<void>;
  positions?: Named[];
  facilities?: Named[];
  grantable?: string[] | null;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = editing === 'new' ? null : editing;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const can = (p: string) => !grantable || grantable.includes(p);
  const readOnly = !!current && current.canManage === false;
  const open = (r: CustomRole | 'new') => {
    setConfirmDelete(false);
    setChecked(new Set(r === 'new' ? (catalog.everyday ?? []).filter(can) : r.permissions ?? []));
    setEditing(r);
  };
  const template = (k: keyof typeof ROLE_TEMPLATES) => setChecked(new Set(ROLE_TEMPLATES[k].flatMap((g) => catalog[g] ?? []).filter(can)));
  const toggle = (p: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const label = (x: Named) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const scopeText = (r: CustomRole) => {
    const ps = (r.scopePositionIds ?? []).map((id) => positions.find((p) => p.id === id)).filter(Boolean).map((p) => label(p!));
    const fs = (r.scopeFacilityIds ?? []).map((id) => facilities.find((f) => f.id === id)).filter(Boolean).map((f) => label(f!));
    return ps.length || fs.length ? [...ps, ...fs].join(', ') : null;
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const body = { name: s('name') ?? '', nameFr: s('nameFr'), description: s('description'), permissions: [...checked], scopePositionIds: f.getAll('scopePos').map(String), scopeFacilityIds: f.getAll('scopeFac').map(String) };
    const r = await run('role', () => save(body, current?.id), t('customRoles.saved'));
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('customRoles.title')}
        description={t('customRoles.help')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => open('new')}>{t('customRoles.add')}</Button>}
      />
      <CardBody className="pt-3">
        {!roles.length ? (
          <EmptyState icon={ShieldCheck} title={t('customRoles.none')}>{t('customRoles.noneHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r)} className="grid w-full gap-1 rounded-lg py-3 text-left hover:bg-surface/60">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body-strong">{roleName(r, lng)}</span>
                    <StatusPill tone="neutral" icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}>{t('customRoles.members', { count: r.members ?? 0 })}</StatusPill>
                    {scopeText(r) ? <StatusPill tone="brand" icon={<Building2 className="h-3.5 w-3.5" aria-hidden="true" />}>{scopeText(r)}</StatusPill> : null}
                  </span>
                  {r.description ? <span className="text-small text-muted">{r.description}</span> : null}
                  <span className="text-caption text-muted">{(r.permissions ?? []).map((p) => t(`customRoles.perms.${p}`, { defaultValue: p })).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-small text-muted">{t(grantable ? 'customRoles.limits' : 'customRoles.anything')}</p>
      </CardBody>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? roleName(current, lng) : t('customRoles.add')} description={t('customRoles.formHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void submit(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('customRoles.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={60} defaultValue={current?.name ?? ''} placeholder="Water Works Operator" />}</Field>
            <Field label={t('customRoles.nameFr')} hint={t('jobs.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={60} defaultValue={current?.nameFr ?? ''} placeholder="Opérateur d’aqueduc" />}</Field>
          </div>
          <Field label={t('customRoles.description')} hint={t('common.optional')}>{(p) => <Input {...p} name="description" maxLength={200} defaultValue={current?.description ?? ''} />}</Field>
          {readOnly ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{t('customRoles.beyondYou')}</p> : null}
          {!current && !readOnly ? (
            <div className="grid gap-2">
              <p className="text-small font-semibold">{t('customRoles.startFrom')}</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(ROLE_TEMPLATES) as Array<keyof typeof ROLE_TEMPLATES>).map((k) => (
                  <Button key={k} size="sm" variant="secondary" onClick={() => template(k)}>{t(`customRoles.templates.${k}`)}</Button>
                ))}
              </div>
            </div>
          ) : null}
          {positions.length || facilities.length ? (
            <fieldset className="grid gap-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-small font-semibold">{t('customRoles.department')}</legend>
              <p className="text-caption text-muted">{t('customRoles.departmentHelp')}</p>
              {positions.length ? (
                <div className="grid gap-1.5">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted">{t('customRoles.scopePositions')}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {positions.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-small">
                        <input type="checkbox" name="scopePos" value={p.id} disabled={readOnly} defaultChecked={current?.scopePositionIds?.includes(p.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                        {label(p)}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {facilities.length > 1 ? (
                <div className="grid gap-1.5">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted">{t('customRoles.scopeFacilities')}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {facilities.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-small">
                        <input type="checkbox" name="scopeFac" value={f.id} disabled={readOnly} defaultChecked={current?.scopeFacilityIds?.includes(f.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                        {label(f)}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </fieldset>
          ) : null}
          {Object.entries(catalog).map(([group, perms]) => (
            <fieldset key={group} className="grid gap-2 rounded-xl bg-surface p-4">
              <legend className="px-1 text-small font-semibold">{t(`customRoles.groups.${group}`)}</legend>
              <p className="text-caption text-muted">{t(`customRoles.groupHelp.${group}`)}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {perms.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-small">
                    <input type="checkbox" name="perm" value={p} checked={checked.has(p)} disabled={readOnly || !can(p)} onChange={() => toggle(p)} className="h-5 w-5 accent-[rgb(var(--brand))] disabled:opacity-40" />
                    {t(`customRoles.perms.${p}`, { defaultValue: p })}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            {current && !readOnly ? (
              confirmDelete ? (
                <Button
                  variant="danger"
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  loading={busy === 'del'}
                  onClick={() => void run('del', () => remove(current.id), t('customRoles.deleted')).then(async () => {
                    setEditing(null);
                    await reload();
                  })}
                >
                  {t('customRoles.confirmDelete', { count: current.members ?? 0 })}
                </Button>
              ) : (
                <Button variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setConfirmDelete(true)}>
                  {t('customRoles.delete')}
                </Button>
              )
            ) : (
              <span />
            )}
            <Button type="submit" loading={busy === 'role'} disabled={readOnly}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
