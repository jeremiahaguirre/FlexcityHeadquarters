'use client';

import { UserCog } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RoleEditor } from '@/components/roles/RoleEditor';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { type CustomRole, type RoleCatalog, roleName } from '@/lib/customRoles';
import { useAction, useQuery } from '@/lib/useQuery';

interface Person { id: string; name: string; customRoles: Array<{ id: string; name: string; nameFr: string | null }>; positions: Array<{ id: string; name: string; nameFr: string | null }> }

/** Roles for any job and department, and who holds them. HR and managers (within their own department). */
export default function RolesPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const roles = useQuery<{ roles: CustomRole[]; catalog: RoleCatalog; grantable: string[] | null }>('/api/roles');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const people = useQuery<Person[]>('/api/users');
  const { run, busy } = useAction();
  const [person, setPerson] = useState<Person | null>(null);
  const manageable = (roles.data?.roles ?? []).filter((r) => r.canManage);

  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ids = new FormData(e.currentTarget).getAll('role').map(String);
    // Roles they hold that this person can't manage stay as they are (the API keeps them too).
    const kept = person!.customRoles.filter((r) => !manageable.some((m) => m.id === r.id)).map((r) => r.id);
    const ok = await run('assign', () => api(`/api/users/${person!.id}/roles`, { method: 'PUT', body: { customRoleIds: [...ids, ...kept] } }), t('rolesPage.assigned'));
    if (ok !== undefined) {
      setPerson(null);
      await Promise.all([people.reload(), roles.reload()]);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('rolesPage.title')} description={t('rolesPage.description')} />
      {!roles.data || !positions.data || !facilities.data ? (
        <Skeleton className="h-64" />
      ) : (
        <RoleEditor
          roles={roles.data.roles}
          catalog={roles.data.catalog}
          grantable={roles.data.grantable}
          positions={positions.data}
          facilities={facilities.data}
          save={(body, id) => (id ? api(`/api/roles/${id}`, { method: 'PUT', body }) : api('/api/roles', { method: 'POST', body }))}
          remove={(id) => api(`/api/roles/${id}`, { method: 'DELETE' })}
          reload={roles.reload}
        />
      )}
      <Card>
        <CardHeader title={t('rolesPage.people')} description={t('rolesPage.peopleHelp')} />
        <CardBody className="pt-2">
          {!people.data ? (
            <Skeleton className="h-40" />
          ) : !people.data.length ? (
            <EmptyState icon={UserCog} title={t('rolesPage.nobody')}>{t('rolesPage.nobodyHelp')}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {people.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-small">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-caption text-muted">
                      {[...p.positions.map((x) => roleName(x, lng)), ...p.customRoles.map((r) => roleName(r, lng))].join(' · ') || t('rolesPage.noRoles')}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={!manageable.length} onClick={() => setPerson(p)}>{t('rolesPage.change')}</Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Dialog open={!!person} onClose={() => setPerson(null)} title={t('rolesPage.rolesFor', { name: person?.name ?? '' })} description={t('rolesPage.rolesForHelp')} closeLabel={t('common.cancel')}>
        {person ? (
          <form key={person.id} className="grid gap-4" onSubmit={(e) => void assign(e)}>
            <div className="grid gap-2">
              {manageable.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-small">
                  <input type="checkbox" name="role" value={r.id} defaultChecked={person.customRoles.some((x) => x.id === r.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                  {roleName(r, lng)}
                </label>
              ))}
            </div>
            <Button type="submit" loading={busy === 'assign'} className="justify-self-start">{t('common.save')}</Button>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
