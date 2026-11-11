'use client';

import { Briefcase, ExternalLink, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { type Job, jobTitle } from '@/lib/jobs';
import { ApplicationsDialog } from '@/components/jobs/Applications';
import { EMPLOYMENT } from '@/lib/staff';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';

/** Job postings for the organization's public careers page (/jobs), in English and French. */
export default function JobsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const jobs = useQuery<Job[]>('/api/jobs');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Job | 'new' | null>(null);
  const [apps, setApps] = useState<{ id: string; title: string } | null>(null);
  const current = editing === 'new' ? null : editing;
  const today = todayIso();

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const body = {
      title: s('title'),
      titleFr: s('titleFr'),
      description: s('description'),
      descriptionFr: s('descriptionFr'),
      facilityId: s('facility'),
      employmentStatus: s('employment'),
      payMin: s('payMin'),
      payMax: s('payMax'),
      closesOn: s('closesOn'),
      applyUrl: s('applyUrl'),
      applyInApp: f.get('applyInApp') === 'on',
      published: f.get('published') === 'on',
    };
    const r = await run('job', () => (current ? api(`/api/jobs/${current.id}`, { method: 'PATCH', body }) : api('/api/jobs', { method: 'POST', body })), t('jobs.saved'));
    if (r) {
      setEditing(null);
      await jobs.reload();
    }
  }

  const status = (j: Job) => (!j.published ? 'draft' : j.closesOn < today ? 'closed' : 'live');
  const tone = { draft: 'pending', closed: 'inactive', live: 'ok' } as const;
  const pay = (j: Job) => (j.payMin && j.payMax ? `${formatMoney(j.payMin, lng)}–${formatMoney(j.payMax, lng)}/h` : j.payMin ? `${formatMoney(j.payMin, lng)}/h` : null);

  return (
    <>
      <PageHeader
        title={t('jobs.title')}
        description={t('jobs.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/jobs" variant="secondary" icon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}>
              {t('jobs.viewPublic')}
            </ButtonLink>
            <Button icon={<Plus className="h-5 w-5" aria-hidden="true" />} onClick={() => setEditing('new')}>
              {t('jobs.new')}
            </Button>
          </div>
        }
      />
      {jobs.loading ? (
        <ListSkeleton rows={3} />
      ) : !jobs.data?.length ? (
        <EmptyState icon={Briefcase} title={t('jobs.none')}>{t('jobs.noneHelp')}</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {jobs.data.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <button type="button" onClick={() => setEditing(j)} className="min-w-0 flex-1 rounded-lg text-left hover:underline">
              <span className="min-w-0">
                <span className="block text-body-strong">{jobTitle(j, lng)}</span>
                <span className="text-small text-muted">
                  {[t(`staff.employment.${j.employmentStatus}`), j.facility, pay(j), t('jobs.closes', { date: formatDate(`${j.closesOn}T12:00:00`, lng, 'dated') })].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
              <span className="flex flex-wrap items-center gap-2">
                {j.applyInApp ? <Button size="sm" variant="secondary" onClick={() => setApps({ id: j.id, title: jobTitle(j, lng) })}>{t('jobs.applications')}</Button> : null}
                <StatusPill tone={tone[status(j)]}>{t(`jobs.status.${status(j)}`)}</StatusPill>
              </span>
            </div>
          ))}
        </Card>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? jobTitle(current, lng) : t('jobs.new')} description={t('jobs.formHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void save(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('jobs.jobTitle')}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={120} defaultValue={current?.title ?? ''} placeholder="Lifeguard / Swim Instructor" />}</Field>
            <Field label={t('jobs.jobTitleFr')} hint={t('jobs.optional')}>{(p) => <Input {...p} name="titleFr" maxLength={120} defaultValue={current?.titleFr ?? ''} placeholder="Sauveteur / moniteur de natation" />}</Field>
          </div>
          <Field label={t('jobs.jobDescription')} hint={t('jobs.descriptionHint')}>{(p) => <Textarea {...p} name="description" required minLength={20} maxLength={6000} defaultValue={current?.description ?? ''} className="min-h-[9rem]" />}</Field>
          <Field label={t('jobs.jobDescriptionFr')} hint={t('jobs.optional')}>{(p) => <Textarea {...p} name="descriptionFr" maxLength={6000} defaultValue={current?.descriptionFr ?? ''} className="min-h-[6rem]" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('jobs.facility')}>
              {(p) => (
                <Select {...p} name="facility" defaultValue={current?.facilityId ?? ''}>
                  <option value="">{t('jobs.anyFacility')}</option>
                  {facilities.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('staff.employmentLabel')}>
              {(p) => (
                <Select {...p} name="employment" defaultValue={current?.employmentStatus ?? 'PART_TIME'}>
                  {EMPLOYMENT.map((x) => (
                    <option key={x} value={x}>
                      {t(`staff.employment.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('jobs.payMin')} hint={t('jobs.payHint')}>{(p) => <Input {...p} name="payMin" inputMode="decimal" defaultValue={current?.payMin ?? ''} placeholder="21.50" />}</Field>
            <Field label={t('jobs.payMax')}>{(p) => <Input {...p} name="payMax" inputMode="decimal" defaultValue={current?.payMax ?? ''} placeholder="26.75" />}</Field>
            <Field label={t('jobs.closesOn')}>{(p) => <Input {...p} name="closesOn" type="date" required defaultValue={current?.closesOn ?? plusDays(today, 21)} />}</Field>
            <Field label={t('jobs.applyUrl')} hint={t('jobs.applyUrlHintInApp')}>{(p) => <Input {...p} name="applyUrl" defaultValue={current?.applyUrl ?? ''} placeholder="https:// or mailto:" />}</Field>
          </div>
          <label className="flex items-center gap-2 text-small font-semibold">
            <input type="checkbox" name="published" defaultChecked={current?.published ?? false} className="h-5 w-5 accent-[rgb(var(--brand))]" />
            {t('jobs.publish')}
          </label>
          <label className="flex items-start gap-2 text-small font-semibold">
            <input type="checkbox" name="applyInApp" defaultChecked={current?.applyInApp ?? true} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
            <span>{t('jobs.applyInApp')}<span className="block font-normal text-muted">{t('jobs.applyInAppHelp')}</span></span>
          </label>
          <Button type="submit" loading={busy === 'job'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
      <ApplicationsDialog job={apps} onClose={() => setApps(null)} />
    </>
  );
}
