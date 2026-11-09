'use client';

import { Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { type CustomRole, type RoleCatalog, type RoleInput, roleName } from '@/lib/customRoles';
import { useAction } from '@/lib/useQuery';

/**
 * A city's own roles for non-aquatic jobs (water works, maintenance…).
 * Only the capabilities in the catalog are offered; pool screens never are.
 */
export function RoleEditor({
  roles,
  catalog,
  save,
  remove,
  reload,
}: {
  roles: CustomRole[];
  catalog: RoleCatalog;
  save: (body: RoleInput, id?: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  reload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = editing === 'new' ? null : editing;
  const defaults = new Set(current?.permissions ?? catalog.everyday ?? []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const body = { name: s('name') ?? '', nameFr: s('nameFr'), description: s('description'), permissions: f.getAll('perm').map(String) };
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
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('customRoles.add')}</Button>}
      />
      <CardBody className="pt-3">
        {!roles.length ? (
          <EmptyState icon={ShieldCheck} title={t('customRoles.none')}>{t('customRoles.noneHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setConfirmDelete(false); setEditing(r); }} className="grid w-full gap-1 rounded-lg py-3 text-left hover:bg-surface/60">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body-strong">{roleName(r, lng)}</span>
                    <StatusPill tone="neutral" icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}>{t('customRoles.members', { count: r.members ?? 0 })}</StatusPill>
                  </span>
                  {r.description ? <span className="text-small text-muted">{r.description}</span> : null}
                  <span className="text-caption text-muted">{(r.permissions ?? []).map((p) => t(`customRoles.perms.${p}`, { defaultValue: p })).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-small text-muted">{t('customRoles.noPool')}</p>
      </CardBody>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? roleName(current, lng) : t('customRoles.add')} description={t('customRoles.formHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void submit(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('customRoles.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={60} defaultValue={current?.name ?? ''} placeholder="Water Works Operator" />}</Field>
            <Field label={t('customRoles.nameFr')} hint={t('jobs.optional')}>{(p) => <Input {...p} name="nameFr" maxLength={60} defaultValue={current?.nameFr ?? ''} placeholder="Opérateur d’aqueduc" />}</Field>
          </div>
          <Field label={t('customRoles.description')} hint={t('common.optional')}>{(p) => <Input {...p} name="description" maxLength={200} defaultValue={current?.description ?? ''} />}</Field>
          {Object.entries(catalog).map(([group, perms]) => (
            <fieldset key={group} className="grid gap-2 rounded-xl bg-surface p-4">
              <legend className="px-1 text-small font-semibold">{t(`customRoles.groups.${group}`)}</legend>
              <p className="text-caption text-muted">{t(`customRoles.groupHelp.${group}`)}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {perms.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-small">
                    <input type="checkbox" name="perm" value={p} defaultChecked={defaults.has(p)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                    {t(`customRoles.perms.${p}`, { defaultValue: p })}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            {current ? (
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
            <Button type="submit" loading={busy === 'role'}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
