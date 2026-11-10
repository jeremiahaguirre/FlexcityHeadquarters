'use client';

import { Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { type CustomRole, roleName } from '@/lib/customRoles';
import { EMPLOYMENT, type Position, ROLES } from '@/lib/staff';
import { useAction, useQuery } from '@/lib/useQuery';
import { DepartmentTabs } from '@/components/DepartmentTabs';
import { departmentParam, useDepartmentTab } from '@/lib/departments';

interface Person {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: string;
  employmentStatus: string;
  positions: Position[];
  nextCertExpiry: string | null;
  certAttention: boolean;
  unverifiedCerts: number;
  invited: boolean;
  customRoles?: CustomRole[];
}

export default function StaffPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [q, setQ] = useState('');
  const [department, setDepartment] = useDepartmentTab();
  const people = useQuery<Person[]>(`/api/users?status=${status}${q.trim().length > 1 ? `&q=${encodeURIComponent(q.trim())}` : ''}${departmentParam(department)}`);
  const positions = useQuery<Position[]>('/api/positions');
  const cityRoles = useQuery<{ roles: CustomRole[] }>('/api/roles');
  const { run, busy } = useAction();
  const [inviting, setInviting] = useState(false);
  const posName = (p: Position) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const r = await run(
      'invite',
      () =>
        api('/api/users', {
          method: 'POST',
          body: {
            firstName: s('firstName'),
            lastName: s('lastName'),
            email: s('email'),
            // Only city roles picked → the general employee base underneath.
            roles: f.getAll('roles').length ? f.getAll('roles') : f.getAll('customRoles').length ? ['EMPLOYEE'] : [],
            customRoleIds: f.getAll('customRoles'),
            employmentStatus: s('employment'),
            locale: s('locale'),
            hireDate: s('hireDate'),
            dateOfBirth: s('dob'),
            employeeNumber: s('employeeNumber'),
            positionIds: f.getAll('positions'),
          },
        }),
      t('staff.invited'),
    );
    if (r) {
      setInviting(false);
      await people.reload();
    }
  }

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        description={t('staff.description')}
        actions={
          can('users.write') ? (
            <Button icon={<UserPlus className="h-5 w-5" aria-hidden="true" />} onClick={() => setInviting(true)}>
              {t('staff.invite')}
            </Button>
          ) : undefined
        }
      />
      <div className="mb-3">
        <DepartmentTabs value={department} onChange={setDepartment} />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input aria-label={t('staff.search')} placeholder={t('staff.search')} value={q} onChange={(e) => setQ(e.target.value)} className="pl-11" />
        </div>
        <Segmented
          label={t('staff.status')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ACTIVE', label: t('staff.active') },
            { value: 'INACTIVE', label: t('staff.inactive') },
          ]}
        />
      </div>
      {people.loading ? (
        <ListSkeleton rows={5} />
      ) : !people.data?.length ? (
        <EmptyState icon={Users} title={t('staff.none')} />
      ) : (
        <Card className="divide-y divide-line">
          {people.data.map((p) => (
            <Link key={p.id} href={`/manage/staff/person?id=${p.id}`} className="flex flex-wrap items-center gap-4 px-4 py-3 hover:bg-surface/60">
              <Avatar name={p.name} />
              <div className="min-w-0 flex-1">
                <p className="text-body-strong">{p.name}</p>
                <p className="truncate text-small text-muted">
                  {t(`staff.employment.${p.employmentStatus}`)} · {p.positions.map(posName).join(', ') || t('staff.noPositions')}
                </p>
              </div>
              <div className="flex basis-full flex-wrap items-center gap-1.5 pl-14 empty:hidden sm:basis-auto sm:pl-0">
                {p.invited ? <StatusPill tone="new">{t('staff.pendingInvite')}</StatusPill> : null}
                {p.unverifiedCerts ? <StatusPill tone="neutral">{t('staff.toVerify', { count: p.unverifiedCerts })}</StatusPill> : null}
                {p.certAttention ? <StatusPill tone="warn">{t('staff.certSoon')}</StatusPill> : null}
                {p.customRoles?.map((r) => (
                  <StatusPill key={r.id} tone="brand">
                    {roleName(r, lng)}
                  </StatusPill>
                ))}
                {p.roles.filter((r) => r !== 'STAFF' && !(r === 'EMPLOYEE' && p.customRoles?.length)).map((r) => (
                  <StatusPill key={r} tone="brand">
                    {t(`roles.${r}`)}
                  </StatusPill>
                ))}
              </div>
            </Link>
          ))}
        </Card>
      )}

      <Dialog open={inviting} onClose={() => setInviting(false)} title={t('staff.invite')} description={t('staff.inviteHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void invite(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('staff.firstName')}>{(p) => <Input {...p} name="firstName" required autoComplete="off" />}</Field>
            <Field label={t('staff.lastName')}>{(p) => <Input {...p} name="lastName" required autoComplete="off" />}</Field>
          </div>
          <Field label={t('login.email')}>{(p) => <Input {...p} name="email" type="email" required autoComplete="off" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('staff.employmentLabel')}>
              {(p) => (
                <Select {...p} name="employment" defaultValue="PART_TIME">
                  {EMPLOYMENT.map((x) => (
                    <option key={x} value={x}>
                      {t(`staff.employment.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('profile.language')}>
              {(p) => (
                <Select {...p} name="locale" defaultValue="en-CA">
                  <option value="en-CA">English</option>
                  <option value="fr-CA">Français</option>
                </Select>
              )}
            </Field>
            <Field label={t('staff.hireDate')}>{(p) => <Input {...p} name="hireDate" type="date" />}</Field>
            <Field label={t('staff.dob')} hint={t('staff.dobHint')}>{(p) => <Input {...p} name="dob" type="date" />}</Field>
          </div>
          <Field label={t('staff.employeeNumber')} hint={t('staff.employeeNumberHint')}>{(p) => <Input {...p} name="employeeNumber" />}</Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-small font-semibold">{t('staff.roles')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-small">
                  <input type="checkbox" name="roles" value={r} defaultChecked={r === 'STAFF'} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                  {t(`roles.${r}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {cityRoles.data?.roles.length ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-small font-semibold">{t('customRoles.cityRoles')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {cityRoles.data.roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-small">
                    <input type="checkbox" name="customRoles" value={r.id} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                    {roleName(r, lng)}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-small font-semibold">{t('staff.approvedPositions')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {positions.data?.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-small">
                  <input type="checkbox" name="positions" value={p.id} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                  {posName(p)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInviting(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={busy === 'invite'} icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}>
              {t('staff.sendInvite')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
