'use client';

import { GraduationCap, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatHours } from '@/lib/format';
import { type Course, type TrainingDue, type TrainingRecord, courseName } from '@/lib/hr';
import { todayIso, useAction, useQuery } from '@/lib/useQuery';

const DUE_TONE: Record<TrainingDue['status'], Tone> = { MISSING: 'danger', EXPIRED: 'danger', DUE_SOON: 'warn' };

/** On the profile: my training record and anything I still need. */
export function MyTraining() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ courses: Course[]; records: TrainingRecord[]; due: TrainingDue[] }>('/api/me/training');
  if (data.error || !data.data || (!data.data.records.length && !data.data.due.length)) return null;
  const c = (id: string) => data.data!.courses.find((x) => x.id === id);
  return (
    <Card>
      <CardHeader title={t('training.myTitle')} description={t('training.myHelp')} />
      <CardBody className="grid gap-3 pt-2 text-small">
        {data.data.due.map((d) => (
          <p key={d.courseId} className="flex flex-wrap items-center gap-2"><StatusPill tone={DUE_TONE[d.status]}>{t(`training.due.${d.status}`)}</StatusPill>{c(d.courseId) ? courseName(c(d.courseId)!, lng) : ''}{d.expiresOn ? ` · ${formatDate(d.expiresOn, lng, 'dated')}` : ''}</p>
        ))}
        <ul className="divide-y divide-line">
          {data.data.records.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-semibold">{c(r.courseId) ? courseName(c(r.courseId)!, lng) : ''}</span>
              <span className="text-muted">{formatDate(r.completedOn, lng, 'dated')}{r.trainer ? ` · ${r.trainer}` : ''}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** HR sets up courses; HR and supervisors record sessions and see who is due. */
export function TrainingPanel({ canSetUp }: { canSetUp: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ courses: Course[]; records: TrainingRecord[]; due: TrainingDue[]; people: Array<{ id: string; name: string }> }>('/api/training');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>(canSetUp ? '/api/positions' : null);
  const [course, setCourse] = useState<Course | 'new' | null>(null);
  const [recording, setRecording] = useState<Course | null>(null);
  const [who, setWho] = useState<string[]>([]);
  const [posIds, setPosIds] = useState<string[]>([]);
  const { run, busy } = useAction();

  async function saveCourse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const renew = String(f.get('renew') ?? '').trim();
    const body = { name: String(f.get('name')).trim(), nameFr: String(f.get('nameFr') ?? '').trim() || null, hours: Number(f.get('hours') || 0), mandatory: f.get('mandatory') === 'on', renewMonths: renew ? Number(renew) : null, positionIds: posIds, active: true };
    const r = await run('course', () => (course === 'new' ? api('/api/training/courses', { method: 'POST', body }) : api(`/api/training/courses/${(course as Course).id}`, { method: 'PUT', body })), t('training.courseSaved'));
    if (r !== undefined) {
      setCourse(null);
      await data.reload();
    }
  }
  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!recording) return;
    const f = new FormData(e.currentTarget);
    const r = await run('record', () => api('/api/training/records', { method: 'POST', body: { courseId: recording.id, userIds: who, completedOn: f.get('completedOn'), hours: f.get('hours') ? Number(f.get('hours')) : null, trainer: String(f.get('trainer') ?? '').trim() || null } }), t('training.recorded', { count: who.length }));
    if (r !== undefined) {
      setRecording(null);
      await data.reload();
    }
  }

  if (!data.data) return <Skeleton className="h-64" />;
  const d = data.data;
  const due = d.due.filter((x) => x.status !== 'DUE_SOON');
  const soon = d.due.filter((x) => x.status === 'DUE_SOON');
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('training.dueTitle')} description={t('training.dueHelp', { overdue: due.length, soon: soon.length })} />
        <CardBody className="pt-2">
          {!d.due.length ? (
            <p className="text-muted">{t('training.allCurrent')}</p>
          ) : (
            <ul className="divide-y divide-line text-small">
              {[...due, ...soon].slice(0, 100).map((x) => {
                const c = d.courses.find((k) => k.id === x.courseId);
                return (
                  <li key={`${x.userId}-${x.courseId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><span className="font-semibold">{x.name}</span> · {c ? courseName(c, lng) : ''}</span>
                    <span className="flex items-center gap-2">{x.expiresOn ? <span className="text-muted">{formatDate(x.expiresOn, lng, 'dated')}</span> : null}<StatusPill tone={DUE_TONE[x.status]}>{t(`training.due.${x.status}`)}</StatusPill></span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('training.courses')} action={canSetUp ? <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => { setPosIds([]); setCourse('new'); }}>{t('training.addCourse')}</Button> : undefined} />
        <CardBody className="pt-2">
          {!d.courses.length ? (
            <EmptyState icon={GraduationCap} title={t('training.noCourses')}>{t('training.noCoursesHelp')}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {d.courses.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="flex flex-wrap items-center gap-2 text-body-strong">{courseName(c, lng)}{c.mandatory ? <StatusPill tone="brand">{t('training.mandatory')}</StatusPill> : null}</span>
                    <span className="text-caption text-muted">{[c.hours ? formatHours(c.hours, lng) : '', c.renewMonths ? t('training.renewsEvery', { months: c.renewMonths }) : t('training.noRenewal'), t('training.completed', { count: d.records.filter((r) => r.courseId === c.id).length })].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setWho([]); setRecording(c); }}>{t('training.record')}</Button>
                    {canSetUp ? <Button size="sm" variant="ghost" onClick={() => { setPosIds(c.positionIds); setCourse(c); }}>{t('common.edit')}</Button> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Dialog open={!!course} onClose={() => setCourse(null)} title={course === 'new' ? t('training.addCourse') : t('training.editCourse')}>
        {course ? (
          <form onSubmit={(e) => void saveCourse(e)} className="grid gap-3">
            <Field label={t('training.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} defaultValue={course === 'new' ? '' : course.name} />}</Field>
            <Field label={t('training.nameFr')}>{(p) => <Input {...p} name="nameFr" maxLength={80} defaultValue={course === 'new' ? '' : (course.nameFr ?? '')} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('training.hours')}>{(p) => <Input {...p} name="hours" type="number" min={0} step="0.25" defaultValue={course === 'new' ? '' : course.hours || ''} />}</Field>
              <Field label={t('training.renewMonths')} hint={t('training.renewHint')}>{(p) => <Input {...p} name="renew" type="number" min={1} max={120} defaultValue={course === 'new' ? '' : (course.renewMonths ?? '')} />}</Field>
            </div>
            <label className="flex items-center gap-2 text-small"><input type="checkbox" name="mandatory" defaultChecked={course !== 'new' && course.mandatory} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('training.mandatoryLabel')}</label>
            <Field label={t('training.forPositions')} hint={t('training.forPositionsHint')}>{(p) => <MultiSelect {...p} name="positions" placeholder={t('training.allPositions')} options={(positions.data ?? []).map((x) => ({ value: x.id, label: lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name }))} defaultValue={posIds} onChange={setPosIds} />}</Field>
            <div><Button type="submit" loading={busy === 'course'}>{t('common.save')}</Button></div>
          </form>
        ) : null}
      </Dialog>
      <Dialog open={!!recording} onClose={() => setRecording(null)} title={recording ? t('training.recordFor', { course: courseName(recording, lng) }) : ''}>
        {recording ? (
          <form onSubmit={(e) => void record(e)} className="grid gap-3">
            <Field label={t('training.attendees')}>{(p) => <MultiSelect {...p} name="attendees" placeholder={t('training.pickPeople')} options={d.people.map((x) => ({ value: x.id, label: x.name }))} onChange={setWho} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('training.completedOn')}>{(p) => <Input {...p} name="completedOn" type="date" required max={todayIso()} defaultValue={todayIso()} />}</Field>
              <Field label={t('training.hours')}>{(p) => <Input {...p} name="hours" type="number" min={0} step="0.25" defaultValue={recording.hours || ''} />}</Field>
            </div>
            <Field label={t('training.trainer')}>{(p) => <Input {...p} name="trainer" maxLength={80} />}</Field>
            <div><Button type="submit" disabled={!who.length} loading={busy === 'record'}>{t('training.save', { count: who.length })}</Button></div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
