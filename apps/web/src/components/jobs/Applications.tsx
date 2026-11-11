'use client';

import { Download, Send, UserPlus } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { FileInput } from '@/components/ui/FileInput';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { EMPLOYMENT } from '@/lib/staff';
import type { WorkAge } from '@/lib/jobs';
import { useAction, useQuery } from '@/lib/useQuery';

const STATUSES = ['NEW', 'REVIEWING', 'INTERVIEW', 'OFFERED', 'DECLINED', 'WITHDRAWN'] as const;
type Status = (typeof STATUSES)[number] | 'HIRED';
const TONE: Record<Status, Tone> = { NEW: 'new', REVIEWING: 'brand', INTERVIEW: 'brand', OFFERED: 'warn', HIRED: 'ok', DECLINED: 'neutral', WITHDRAWN: 'neutral' };
interface App { id: string; name: string; email: string; phone: string | null; message: string | null; certifications: string | null; status: Status; notes: string | null; resume: { name: string; size: number } | null; createdAt: string }

/** Public job page: apply in the app. */
export function ApplyForm({ jobId, workAge }: { jobId: string; workAge?: WorkAge }) {
  const { t } = useTranslation();
  // Working age without a birth date: "16 or older", or "14 or 15" with a parent's or guardian's consent.
  const ages = workAge ?? { province: null, adultAge: 16, minAge: 14, link: null };
  const [age, setAge] = useState<'ADULT' | 'YOUNG' | null>(null);
  const started = useRef(Date.now());
  const [resume, setResume] = useState<{ fileName: string; data: string } | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    if (!f) return setResume(null);
    const r = new FileReader();
    r.onload = () => setResume({ fileName: f.name, data: String(r.result) });
    r.readAsDataURL(f);
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    setState('sending');
    setError(null);
    const r = await fetch(`/api/public/jobs/${jobId}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: s('firstName'), lastName: s('lastName'), email: s('email'), phone: s('phone'), certifications: s('certs'), message: s('message'), resume, consent: f.get('consent') === 'on', age, guardianConsent: age === 'YOUNG' && f.get('guardianConsent') === 'on', guardianName: age === 'YOUNG' ? (s('guardianName') ?? '') : '', website: s('website') ?? '', startedAt: started.current }) });
    if (r.ok) return setState('sent');
    const body = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
    setError(t(`jobs.applyErrors.${body.code ?? 'ERROR'}`, { defaultValue: body.message ?? t('jobs.applyErrors.ERROR') }));
    setState('idle');
  }
  if (state === 'sent') return <p role="status" className="rounded-2xl border border-ok/40 bg-ok/10 p-4 text-body text-ink">{t('jobs.applied')}</p>;
  return (
    <form id="apply" onSubmit={(e) => void submit(e)} className="grid gap-4 rounded-2xl border border-line bg-panel p-4 sm:p-6">
      <h2 className="text-heading">{t('jobs.applyHere')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('jobs.firstName')}>{(p) => <Input {...p} name="firstName" required maxLength={60} autoComplete="given-name" />}</Field>
        <Field label={t('jobs.lastName')}>{(p) => <Input {...p} name="lastName" required maxLength={60} autoComplete="family-name" />}</Field>
        <Field label={t('jobs.email')}>{(p) => <Input {...p} name="email" type="email" required maxLength={160} autoComplete="email" />}</Field>
        <Field label={t('jobs.phone')}>{(p) => <Input {...p} name="phone" type="tel" maxLength={30} autoComplete="tel" />}</Field>
      </div>
      <Field label={t('jobs.certs')} hint={t('jobs.certsHint')}>{(p) => <Input {...p} name="certs" maxLength={1000} />}</Field>
      <Field label={t('jobs.message')}>{(p) => <Textarea {...p} name="message" maxLength={4000} rows={4} />}</Field>
      <Field label={t('jobs.resume')} hint={t('jobs.resumeHint')}>{(p) => <FileInput {...p} accept="application/pdf" onFile={pick} />}</Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-small font-semibold text-ink">{t('jobs.ageLegend')}</legend>
        <label className="flex min-h-11 items-center gap-2 text-small text-ink"><input type="radio" name="age" value="ADULT" required checked={age === 'ADULT'} onChange={() => setAge('ADULT')} className="h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />{t('jobs.ageAdult', { age: ages.adultAge })}</label>
        <label className="flex min-h-11 items-center gap-2 text-small text-ink"><input type="radio" name="age" value="YOUNG" required checked={age === 'YOUNG'} onChange={() => setAge('YOUNG')} className="h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />{t('jobs.ageYoung', { min: ages.minAge, max: ages.adultAge - 1 })}</label>
        {age === 'YOUNG' ? (
          <div className="grid gap-3 rounded-xl border border-line bg-surface p-3">
            <p className="text-caption text-muted">{t('jobs.ageYoungHelp', { age: ages.adultAge })}</p>
            {ages.link ? <a href={ages.link} target="_blank" rel="noopener noreferrer" className="text-caption font-semibold text-brand-text hover:underline">{t('jobs.ageRules', { province: ages.province })}</a> : null}
            <Field label={t('jobs.guardianName')}>{(p) => <Input {...p} name="guardianName" required minLength={2} maxLength={120} autoComplete="off" />}</Field>
            <label className="flex items-start gap-2 text-small text-ink"><input type="checkbox" name="guardianConsent" required className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" /><span>{t('jobs.guardianConsent')}</span></label>
          </div>
        ) : null}
        <p className="text-caption text-muted">{t('jobs.ageUnder', { age: ages.minAge })}</p>
      </fieldset>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <label className="flex items-start gap-2 text-small text-ink"><input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" /><span>{t('jobs.consent')}</span></label>
      {error ? <p role="alert" className="text-small text-danger">{error}</p> : null}
      <Button type="submit" className="justify-self-start" loading={state === 'sending'} icon={<Send className="h-4 w-4" aria-hidden="true" />}>{t('jobs.send')}</Button>
    </form>
  );
}

/** HR: one posting's applications. */
export function ApplicationsDialog({ job, onClose }: { job: { id: string; title: string } | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const q = useQuery<App[]>(job ? `/api/jobs/${job.id}/applications` : null);
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>(job ? '/api/positions' : null);
  const { run, busy } = useAction();
  const [hiring, setHiring] = useState<App | null>(null);
  const [pos, setPos] = useState<string[]>([]);
  const update = (id: string, body: object) => run(id, () => api(`/api/applications/${id}`, { method: 'PATCH', body }), t('jobs.appSaved')).then(() => q.reload());
  async function hire(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('hire', () => api(`/api/applications/${hiring!.id}/hire`, { method: 'POST', body: { role: String(f.get('role')), employmentStatus: String(f.get('employment')), positionIds: pos, hireDate: String(f.get('hireDate') || '') || null } }), t('jobs.hired'));
    if (r !== undefined) { setHiring(null); setPos([]); await q.reload(); }
  }
  return (
    <Dialog open={!!job} onClose={onClose} title={t('jobs.applicationsFor', { title: job?.title ?? '' })} closeLabel={t('common.close')}>
      {!q.data ? <Skeleton className="h-40" /> : !q.data.length ? <p className="text-body text-muted">{t('jobs.noApplications')}</p> : (
        <ul className="grid gap-3">
          {q.data.map((a) => (
            <li key={a.id} className="grid gap-2 rounded-xl border border-line p-3 text-small">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-body-strong text-ink">{a.name}</span><StatusPill tone={TONE[a.status]}>{t(`jobs.appStatus.${a.status}`)}</StatusPill></div>
              <p className="text-muted">{a.email}{a.phone ? ` · ${a.phone}` : ''} · {formatDate(a.createdAt, i18n.language)}</p>
              {a.certifications ? <p><span className="font-semibold">{t('jobs.certs')}:</span> {a.certifications}</p> : null}
              {a.message ? <p className="whitespace-pre-wrap text-ink">{a.message}</p> : null}
              <div className="flex flex-wrap items-end gap-2">
                {a.resume ? <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void apiDownload(`/api/applications/${a.id}/resume`).then((r) => r.ok && saveBlob(r.blob, a.resume!.name))}>{t('jobs.resumeDownload')}</Button> : null}
                {a.status !== 'HIRED' ? (
                  <>
                    <Field label={t('jobs.stage')} className="w-48">{(f) => <Select {...f} value={a.status} disabled={busy === a.id} onChange={(e) => void update(a.id, { status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{t(`jobs.appStatus.${s}`)}</option>)}</Select>}</Field>
                    <Button size="sm" icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setHiring(a)}>{t('jobs.hire')}</Button>
                  </>
                ) : null}
              </div>
              <Field label={t('jobs.notes')} hint={t('jobs.notesSaveHint')}>{(f) => <Textarea {...f} defaultValue={a.notes ?? ''} placeholder={t('jobs.notesPlaceholder')} rows={2} onBlur={(e) => { if (e.target.value !== (a.notes ?? '')) void update(a.id, { notes: e.target.value || null }); }} />}</Field>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-caption text-muted">{t('jobs.retention')}</p>
      <Dialog open={!!hiring} onClose={() => setHiring(null)} title={t('jobs.hireTitle', { name: hiring?.name ?? '' })} description={t('jobs.hireHelp')} closeLabel={t('common.cancel')}>
        <form onSubmit={(e) => void hire(e)} className="grid gap-4">
          <Field label={t('jobs.role')}>{(p) => <Select {...p} name="role" defaultValue="STAFF">{(['STAFF', 'EMPLOYEE', 'FRONT_DESK', 'HEAD_LIFEGUARD'] as const).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</Select>}</Field>
          <Field label={t('jobs.employment')}>{(p) => <Select {...p} name="employment" defaultValue="CASUAL">{EMPLOYMENT.map((x) => <option key={x} value={x}>{t(`staff.employment.${x}`)}</option>)}</Select>}</Field>
          <Field label={t('jobs.positions')}>{(p) => <MultiSelect id={p.id} name="positions" options={(positions.data ?? []).map((x) => ({ value: x.id, label: (i18n.language === 'fr-CA' && x.nameFr) || x.name }))} onChange={setPos} placeholder={t('jobs.choosePositions')} />}</Field>
          <Field label={t('jobs.hireDate')}>{(p) => <Input {...p} name="hireDate" type="date" />}</Field>
          <Button type="submit" className="justify-self-start" loading={busy === 'hire'}>{t('jobs.hireSend')}</Button>
        </form>
      </Dialog>
    </Dialog>
  );
}
