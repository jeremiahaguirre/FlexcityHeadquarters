'use client';

import { ArrowLeft, BadgeCheck, FileDown, MailPlus, Plus, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { AccommodationPanel } from '@/components/people/AccommodationPanel';
import { CaseFilePanel } from '@/components/people/CaseFilePanel';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { CustomRole } from '@/lib/customRoles';
import { EMPLOYMENT, type Position, ROLES, TIERS } from '@/lib/staff';
import { useAction, useQuery } from '@/lib/useQuery';
import { DocumentsCard } from '@/components/people/DocumentsCard';
import { EmergencyContactsCard } from '@/components/people/EmergencyContacts';

interface Detail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  roles: string[];
  status: string;
  employmentStatus: string;
  shadowTier: string;
  employeeNumber: string | null;
  hireDate: string | null;
  seniorityDate: string | null;
  seniorityHours: string;
  weeklyMinHours: string | null;
  weeklyMaxHours: string | null;
  vscClearedDate: string | null;
  dateOfBirth?: string | null;
  unionMember: boolean;
  invited: boolean;
  customRoles: CustomRole[];
  positions: Position[];
  certifications: Array<{ id: string; certification: { name: string; nameFr: string | null }; expiryDate: string | null; verified: boolean }>;
  payRates?: Array<{ id: string; position: string; hourlyRate: string; effectiveFrom: string; effectiveTo: string | null }>;
}
interface Record { id: string; summary: string; issuedAt: string; acknowledgedAt: string | null; stewardPresent: boolean }

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody className="pt-3">{children}</CardBody>
    </Card>
  );
}

function Person() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const id = useSearchParams().get('id') ?? '';
  const { can, me } = useSession();
  const person = useQuery<Detail>(id ? `/api/users/${id}` : null);
  const positions = useQuery<Position[]>('/api/positions');
  const catalog = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>(can('certs.verify') ? '/api/certifications' : null);
  const cityRoles = useQuery<{ roles: CustomRole[] }>('/api/roles');
  const records = useQuery<Record[]>(can('discipline.read') && id ? `/api/users/${id}/discipline` : null);
  const { run, busy } = useAction();
  const [dialog, setDialog] = useState<'cert' | 'rate' | 'record' | 'erase' | null>(null);
  const p = person.data;
  if (person.error) return <ErrorNotice onRetry={person.reload} />;
  if (!p) return <Skeleton className="h-96" />;
  const name = `${p.firstName} ${p.lastName}`;
  const posName = (x: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const d = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00`, lng, 'dated') : '—');
  const val = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
  const done = async () => {
    setDialog(null);
    await person.reload();
  };

  async function saveHr(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run('hr', () =>
      api(`/api/users/${id}`, {
        method: 'PATCH',
        body: {
          roles: f.getAll('roles').length ? f.getAll('roles') : f.getAll('customRoles').length ? ['EMPLOYEE'] : [],
          customRoleIds: f.getAll('customRoles'),
          status: val(f, 'status'),
          employmentStatus: val(f, 'employment'),
          hireDate: val(f, 'hireDate'),
          seniorityDate: val(f, 'seniorityDate'),
          vscClearedDate: val(f, 'vsc'),
          dateOfBirth: val(f, 'dob'),
          employeeNumber: val(f, 'employeeNumber'),
          unionMember: f.get('union') === 'on',
        },
      }),
      t('profile.saved'),
    );
    await person.reload();
  }

  async function saveScheduling(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run('sched', () =>
      api(`/api/users/${id}/scheduling`, { method: 'PATCH', body: { shadowTier: val(f, 'tier'), weeklyMinHours: val(f, 'min'), weeklyMaxHours: val(f, 'max'), positionIds: f.getAll('positions') } }),
      t('profile.saved'),
    );
    await person.reload();
  }

  return (
    <div className="grid gap-6">
      <Link href="/manage/staff" className="flex w-fit items-center gap-1.5 rounded-lg text-small font-semibold text-brand-text hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('staff.title')}
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-title">{name}</h1>
          <p className="text-body text-muted">
            {p.email}
            {p.phone ? ` · ${p.phone}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={p.status === 'ACTIVE' ? 'ok' : 'neutral'}>{t(`staff.statuses.${p.status}`)}</StatusPill>
          {p.invited ? <StatusPill tone="new">{t('staff.pendingInvite')}</StatusPill> : null}
          {can('users.write') && p.invited && p.status === 'ACTIVE' ? (
            <Button variant="secondary" size="sm" icon={<MailPlus className="h-4 w-4" aria-hidden="true" />} loading={busy === 'invite'} onClick={() => void run('invite', () => api(`/api/users/${id}/invite`, { method: 'POST' }), t('staff.inviteResent'))}>
              {t('staff.resendInvite')}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {can('users.scheduling') ? (
          <Section title={t('staff.scheduling')} description={t('staff.schedulingHelp')}>
            <form onSubmit={(e) => void saveScheduling(e)} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('staff.tier')} className="sm:col-span-2">
                  {(f) => (
                    <Select {...f} name="tier" defaultValue={p.shadowTier}>
                      {TIERS.map((x) => (
                        <option key={x} value={x}>
                          {t(`staff.tiers.${x}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('staff.minHours')}>{(f) => <Input {...f} name="min" inputMode="decimal" defaultValue={p.weeklyMinHours ?? ''} />}</Field>
                <Field label={t('staff.maxHours')}>{(f) => <Input {...f} name="max" inputMode="decimal" defaultValue={p.weeklyMaxHours ?? ''} />}</Field>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-small font-semibold">{t('staff.approvedPositions')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {positions.data?.map((x) => (
                    <label key={x.id} className="flex items-center gap-2 text-small">
                      <input type="checkbox" name="positions" value={x.id} defaultChecked={p.positions.some((y) => y.id === x.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                      {posName(x)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" className="justify-self-start" loading={busy === 'sched'}>
                {t('common.save')}
              </Button>
            </form>
          </Section>
        ) : null}

        <Section
          title={t('staff.certifications')}
          action={can('certs.verify') && p.id !== me?.id ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('cert')}>{t('staff.addVerified')}</Button> : undefined}
        >
          {!p.certifications.length ? (
            <p className="text-small text-muted">{t('profile.noCerts')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {p.certifications.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-small font-semibold">{posName(c.certification)}</p>
                    <p className="text-caption text-muted">{c.expiryDate ? t('profile.expires', { date: d(c.expiryDate) }) : t('profile.noExpiry')}</p>
                  </div>
                  {c.verified ? <StatusPill tone="ok" icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}>{t('profile.verified')}</StatusPill> : <StatusPill tone="neutral">{t('profile.awaiting')}</StatusPill>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {can('users.write') ? (
          <Section title={t('staff.hrRecord')} description={t('staff.hrHelp')}>
            <form onSubmit={(e) => void saveHr(e)} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('staff.status')}>
                  {(f) => (
                    <Select {...f} name="status" defaultValue={p.status}>
                      {(['ACTIVE', 'INACTIVE', 'TERMINATED'] as const).map((x) => (
                        <option key={x} value={x}>
                          {t(`staff.statuses.${x}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('staff.employmentLabel')}>
                  {(f) => (
                    <Select {...f} name="employment" defaultValue={p.employmentStatus}>
                      {EMPLOYMENT.map((x) => (
                        <option key={x} value={x}>
                          {t(`staff.employment.${x}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('staff.hireDate')}>{(f) => <Input {...f} name="hireDate" type="date" defaultValue={p.hireDate ?? ''} />}</Field>
                {me?.features?.seniority !== false ? <Field label={t('staff.seniorityDate')}>{(f) => <Input {...f} name="seniorityDate" type="date" defaultValue={p.seniorityDate ?? ''} />}</Field> : null}
                <Field label={t('staff.vsc')} hint={t('staff.vscHint')}>{(f) => <Input {...f} name="vsc" type="date" defaultValue={p.vscClearedDate ?? ''} />}</Field>
                <Field label={t('staff.dob')}>{(f) => <Input {...f} name="dob" type="date" defaultValue={p.dateOfBirth ?? ''} />}</Field>
                <Field label={t('staff.employeeNumber')}>{(f) => <Input {...f} name="employeeNumber" defaultValue={p.employeeNumber ?? ''} />}</Field>
              </div>
              <label className="flex items-center gap-2 text-small font-semibold">
                <input type="checkbox" name="union" defaultChecked={p.unionMember} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {t('staff.unionMember')}
              </label>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-small font-semibold">{t('staff.roles')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-small">
                      <input type="checkbox" name="roles" value={r} defaultChecked={p.roles.includes(r)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
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
                        <input type="checkbox" name="customRoles" value={r.id} defaultChecked={p.customRoles.some((x) => x.id === r.id)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                        {posName(r)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <Button type="submit" className="justify-self-start" loading={busy === 'hr'}>
                {t('common.save')}
              </Button>
            </form>
          </Section>
        ) : null}

        {p.payRates ? (
          <Section title={t('staff.payRates')} description={t('staff.payRatesHelp')} action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('rate')}>{t('staff.newRate')}</Button>}>
            {!p.payRates.length ? (
              <p className="text-small text-muted">{t('staff.noRates')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.payRates.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2.5 text-small">
                    <span>
                      <span className="font-semibold">{r.position}</span> · {d(r.effectiveFrom)} – {r.effectiveTo ? d(r.effectiveTo) : t('staff.current')}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(r.hourlyRate, lng)}/h</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {can('users.write') ? <EmergencyContactsCard path={`/api/users/${p.id}/emergency-contacts`} own={false} /> : null}
        {can('accommodation.manage') ? <AccommodationPanel userId={p.id} positions={(positions.data ?? []).map((x) => ({ id: x.id, name: posName(x) }))} /> : null}

        {can('reliability.read') ? <CaseFilePanel userId={p.id} name={name} unionMember={p.unionMember} /> : null}

        {can('discipline.read') && !can('reliability.read') ? (
          <Section title={t('staff.records')} description={t('staff.recordsHelp')} action={can('discipline.write') && p.id !== me?.id ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('record')}>{t('staff.newRecord')}</Button> : undefined}>
            {!records.data?.length ? (
              <p className="text-small text-muted">{t('staff.noRecords')}</p>
            ) : (
              <ul className="grid gap-3">
                {records.data.map((r) => (
                  <li key={r.id} className="rounded-xl bg-surface px-4 py-3 text-small">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{formatDate(r.issuedAt, lng, 'dated')}</span>
                      <StatusPill tone={r.acknowledgedAt ? 'ok' : 'neutral'}>{r.acknowledgedAt ? t('staff.signed') : t('staff.notSigned')}</StatusPill>
                    </div>
                    <p className="whitespace-pre-wrap">{r.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {can('documents.manage') ? <DocumentsCard userId={p.id} mode={me?.roles.includes('HR_ADMIN') ? 'hr' : 'lead'} /> : null}
        {can('users.privacy') ? (
          <Section title={t('staff.privacy')} description={t('staff.privacyHelp')}>
            <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-auto min-h-11 whitespace-normal py-2 text-center"
              icon={<FileDown className="h-4 w-4" aria-hidden="true" />}
              loading={busy === 'export'}
              onClick={() =>
                void run('export', async () => {
                  const r = await apiDownload(`/api/users/${p.id}/records-export`);
                  if (!r.ok) throw new Error('export');
                  saveBlob(r.blob, `records-${p.lastName}-${p.firstName}.json`);
                  return true;
                }, t('staff.exported'))
              }
            >
              {t('staff.exportRecords')}
            </Button>
            <Button
              variant="secondary"
              icon={<FileDown className="h-4 w-4" aria-hidden="true" />}
              loading={busy === 'exportPdf'}
              onClick={() =>
                void run('exportPdf', async () => {
                  const r = await apiDownload(`/api/users/${p.id}/records-export.pdf?lang=${i18n.language.startsWith('fr') ? 'fr' : 'en'}`);
                  if (!r.ok) throw new Error('export');
                  saveBlob(r.blob, `records-${p.lastName}-${p.firstName}.pdf`);
                  return true;
                }, t('staff.exported'))
              }
            >
              {t('staff.exportPdf')}
            </Button>
            <Button variant="danger" icon={<ShieldOff className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('erase')}>
              {t('staff.requestErasure')}
            </Button>
            </div>
          </Section>
        ) : null}
      </div>

      <Dialog open={dialog === 'cert'} onClose={() => setDialog(null)} title={t('staff.addVerified')} description={t('staff.addVerifiedHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run('cert', () => api(`/api/users/${id}/certifications`, { method: 'POST', body: { certificationId: val(f, 'cert'), issueDate: val(f, 'issue'), expiryDate: val(f, 'expiry') } }), t('staff.certAdded')).then(done);
          }}
        >
          <Field label={t('profile.certification')}>
            {(f) => (
              <Select {...f} name="cert" required>
                <option value="">{t('common.choose')}</option>
                {catalog.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {posName(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('profile.issued')}>{(f) => <Input {...f} name="issue" type="date" required />}</Field>
            <Field label={t('profile.expiry')} hint={t('profile.expiryHint')}>{(f) => <Input {...f} name="expiry" type="date" />}</Field>
          </div>
          <Button type="submit" loading={busy === 'cert'}>
            {t('staff.addVerified')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'rate'} onClose={() => setDialog(null)} title={t('staff.newRate')} description={t('staff.newRateHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run('rate', () => api(`/api/users/${id}/pay-rates`, { method: 'POST', body: { positionId: val(f, 'position'), hourlyRate: val(f, 'rate'), effectiveFrom: val(f, 'from') } }), t('staff.rateAdded')).then(done);
          }}
        >
          <Field label={t('builder.position')}>
            {(f) => (
              <Select {...f} name="position" required>
                {positions.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {posName(x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('staff.hourlyRate')}>{(f) => <Input {...f} name="rate" inputMode="decimal" placeholder="22.50" required />}</Field>
            <Field label={t('availability.effectiveFrom')}>{(f) => <Input {...f} name="from" type="date" required />}</Field>
          </div>
          <Button type="submit" loading={busy === 'rate'}>
            {t('staff.saveRate')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'record'} onClose={() => setDialog(null)} title={t('staff.newRecord')} description={t('staff.newRecordHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run('record', () => api(`/api/users/${id}/discipline`, { method: 'POST', body: { summary: val(f, 'summary'), stewardPresent: f.get('steward') === 'on' } }), t('staff.recordSaved')).then(async () => {
              setDialog(null);
              await records.reload();
            });
          }}
        >
          <Field label={t('staff.summary')} hint={t('staff.summaryHint')}>{(f) => <Textarea {...f} name="summary" required minLength={10} maxLength={4000} className="min-h-[10rem]" />}</Field>
          <label className="flex items-center gap-2 text-small font-semibold">
            <input type="checkbox" name="steward" className="h-5 w-5 accent-[rgb(var(--brand))]" />
            {t('staff.stewardPresent')}
          </label>
          <Button type="submit" loading={busy === 'record'}>
            {t('staff.saveRecord')}
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'erase'}
        onClose={() => setDialog(null)}
        title={t('staff.requestErasure')}
        description={t('staff.erasureHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy === 'erase'} onClick={() => void run('erase', () => api<{ erasureDueAt: string }>(`/api/users/${id}/erasure`, { method: 'POST' })).then((r) => r && done())}>
              {t('staff.confirmErasure', { name })}
            </Button>
          </>
        }
      />
    </div>
  );
}

export default function PersonPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Person />
    </Suspense>
  );
}
