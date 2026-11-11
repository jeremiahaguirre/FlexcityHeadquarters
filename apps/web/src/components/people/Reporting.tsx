'use client';

import { Network, Pencil } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

interface Brief { id: string; name: string; positions: Array<{ id: string; name: string; nameFr: string | null }> }
export interface Reporting { source: 'set' | 'department' | null; managers: Brief[]; directReports: Brief[]; reportsToId?: string | null; canEdit?: boolean }

/** A choice of manager: anyone active the viewer can see, or "their department's manager" (empty value). */
export function ManagerSelect({ name = 'managerId', defaultValue = '', exclude = [], label, hint }: { name?: string; defaultValue?: string; exclude?: string[]; label?: string; hint?: string }) {
  const { t } = useTranslation();
  const people = useQuery<Array<{ id: string; name: string }>>('/api/users?status=ACTIVE');
  return (
    <Field label={label ?? t('reporting.manager')} hint={hint ?? t('reporting.managerHint')}>
      {(f) =>
        people.data ? (
          <Select {...f} name={name} defaultValue={defaultValue}>
            <option value="">{t('reporting.departmentDefault')}</option>
            {people.data
              .filter((p) => !exclude.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        ) : (
          <Skeleton className="h-11" />
        )
      }
    </Field>
  );
}

function PersonLine({ p, link }: { p: Brief; link: boolean }) {
  const { i18n } = useTranslation();
  const title = p.positions.map((x) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name)).join(', ');
  const body = (
    <>
      <Avatar name={p.name} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-small font-semibold">{p.name}</span>
        {title ? <span className="block truncate text-caption text-muted">{title}</span> : null}
      </span>
    </>
  );
  return link ? (
    <Link href={`/manage/staff/person?id=${p.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface">
      {body}
    </Link>
  ) : (
    <div className="flex min-h-11 items-center gap-3 px-2 py-1.5">{body}</div>
  );
}

/**
 * "Reports to" and "Direct reports". On a person's page (`userId`) HR and their department's
 * manager can change it; on your own profile it is "My manager" and "My team".
 */
export function ReportingCard({ userId, name }: { userId?: string; name?: string }) {
  const { t } = useTranslation();
  const mine = !userId;
  const data = useQuery<Reporting>(mine ? '/api/me/reporting' : `/api/users/${userId}/reporting`);
  const [editing, setEditing] = useState(false);
  const { run, busy } = useAction();
  const r = data.data;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const managerId = String(new FormData(e.currentTarget).get('managerId') ?? '') || null;
    const ok = await run('manager', () => api(`/api/users/${userId}/manager`, { method: 'PUT', body: { managerId } }), t('reporting.saved'));
    if (ok !== undefined) {
      setEditing(false);
      await data.reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title={mine ? t('reporting.myTitle') : t('reporting.title')}
        description={mine ? t('reporting.myHelp') : undefined}
        action={
          r?.canEdit ? (
            <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
              {t('reporting.change')}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="grid gap-4 pt-3">
        {!r ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div>
              <h3 className="mb-1 text-label uppercase text-muted">{mine ? t('reporting.myManager') : t('reporting.reportsTo')}</h3>
              {r.managers.length ? (
                <ul className="grid gap-1">
                  {r.managers.map((m) => (
                    <li key={m.id}>
                      <PersonLine p={m} link={!mine} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted">{t('reporting.noManager')}</p>
              )}
              {r.source === 'department' ? <p className="mt-1 text-caption text-muted">{t(r.managers.length > 1 ? 'reporting.byDepartmentMany' : 'reporting.byDepartment')}</p> : null}
            </div>
            {r.directReports.length || !mine ? (
              <div>
                <h3 className="mb-1 text-label uppercase text-muted">
                  {mine ? t('reporting.myTeam') : t('reporting.directReports')} {r.directReports.length ? <span className="tabular-nums">· {r.directReports.length}</span> : null}
                </h3>
                {r.directReports.length ? (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {r.directReports.map((m) => (
                      <li key={m.id}>
                        <PersonLine p={m} link={!mine} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted">{t('reporting.noReports')}</p>
                )}
              </div>
            ) : null}
            {!mine ? (
              <Link href="/manage/org-chart" className="flex w-fit items-center gap-1.5 rounded-lg text-small font-semibold text-brand-text hover:underline">
                <Network className="h-4 w-4" aria-hidden="true" />
                {t('reporting.openChart')}
              </Link>
            ) : null}
          </>
        )}
      </CardBody>
      {userId && r ? (
        <Dialog open={editing} onClose={() => setEditing(false)} title={t('reporting.changeTitle', { name: name ?? '' })} description={t('reporting.changeHelp')} closeLabel={t('common.close')}>
          <form onSubmit={(e) => void save(e)} className="grid gap-4">
            <ManagerSelect defaultValue={r.reportsToId ?? ''} exclude={[userId]} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy === 'manager'}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </Card>
  );
}

/**
 * "My team" vs "Everyone I can approve" on an approval queue. My team (the people who report
 * to me) is the default for managers; it only narrows the queue the permission already shows.
 */
export function useTeamScope() {
  const reporting = useQuery<Reporting>('/api/me/reporting');
  const hasTeam = !!reporting.data?.directReports.length;
  const [scope, setScope] = useState<'team' | 'all' | null>(null);
  const team = hasTeam && (scope ?? 'team') === 'team';
  return { hasTeam, team, setScope, ready: !reporting.loading, query: team ? 'team=mine' : '' };
}

export function TeamScopeSwitch({ scope }: { scope: ReturnType<typeof useTeamScope> }) {
  const { t } = useTranslation();
  if (!scope.hasTeam) return null;
  return (
    <Segmented
      label={t('approvals.whose')}
      value={scope.team ? 'team' : 'all'}
      onChange={scope.setScope}
      options={[
        { value: 'team' as const, label: t('approvals.myTeam') },
        { value: 'all' as const, label: t('approvals.everyone') },
      ]}
    />
  );
}
