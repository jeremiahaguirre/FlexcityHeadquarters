'use client';

import { BarChart3, BellRing, ClipboardPen, Copy, Download, EyeOff, Lock, Plus, Send, Trash2, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatInstant } from '@/lib/format';
import { useSession } from '@/lib/session';
import { MAX_REMINDERS, type Question, type QuestionSummary, type QuestionType, type SurveyResults, type SurveyRow, type TrendRow, exitStarterQuestions, share, starterQuestions } from '@/lib/surveys';
import { useAction, useQuery } from '@/lib/useQuery';

type Lng = 'en-CA' | 'fr-CA';
interface Choices { canCreate: boolean; hr: boolean; departments: Array<{ id: string; name: string; nameFr: string | null }>; positions: Array<{ id: string; name: string; nameFr: string | null; departmentId: string | null }>; minGroup: number }
const STATUS_TONE: Record<SurveyRow['status'], Tone> = { DRAFT: 'neutral', OPEN: 'brand', CLOSED: 'ok' };
const TYPES: QuestionType[] = ['RATING', 'CHOICE', 'MULTI', 'TEXT'];
const nm = (x: { name: string; nameFr: string | null }, lng: string) => (lng === 'fr-CA' && x.nameFr) || x.name;

/** HR (and managers, if allowed): build, send, remind, close, and read results that keep people anonymous. */
export function SurveyAdmin() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const { can } = useSession();
  const list = useQuery<SurveyRow[]>('/api/surveys');
  const choices = useQuery<Choices>('/api/surveys-admin/choices');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<EditStart | null>(null);
  // From HR's offboarding screen: ?exit=<offboarding> opens a new exit survey for that person.
  const params = useSearchParams();
  const router = useRouter();
  const exitFor = params.get('exit');
  useEffect(() => {
    if (!exitFor || !choices.data) return;
    if (choices.data.hr) setEditing({ exitFor });
    router.replace('/manage/surveys');
  }, [exitFor, choices.data, router]);
  const [results, setResults] = useState<SurveyRow | null>(null);
  const act = (key: string, path: string, ok: string, method = 'POST') => void run(key, () => api(path, { method }), ok).then(() => list.reload());

  return (
    <div className="grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex max-w-xl gap-2 text-small text-muted"><EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" />{t('surveyAdmin.anonymityNote', { count: choices.data?.minGroup ?? 5 })}</p>
        {choices.data?.canCreate ? <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({})}>{t('surveyAdmin.new')}</Button> : null}
      </div>
      {choices.data && !choices.data.canCreate ? <p className="rounded-xl border border-line bg-surface/60 p-3 text-small text-muted">{t('surveyAdmin.managersOff')}</p> : null}
      {list.loading ? <ListSkeleton /> : !list.data?.length ? (
        <EmptyState icon={ClipboardPen} title={t('surveyAdmin.noneTitle')} action={choices.data?.canCreate ? <Button variant="secondary" onClick={() => setEditing({})}>{t('surveyAdmin.new')}</Button> : undefined}>{t('surveyAdmin.noneBody')}</EmptyState>
      ) : (
        list.data.map((s) => (
          <Card key={s.id}>
            <CardHeader
              title={s.title}
              description={[t(`surveyAdmin.kind.${s.kind}`), s.subject ? `${s.subject.firstName} ${s.subject.lastName}` : null, s.status === 'DRAFT' ? null : t(s.status === 'OPEN' ? 'surveyAdmin.closes' : 'surveyAdmin.closed', { date: formatInstant(s.closesAt, lng) })].filter(Boolean).join(' · ')}
              action={<StatusPill tone={STATUS_TONE[s.status]}>{t(`surveyAdmin.status.${s.status}`)}</StatusPill>}
            />
            <CardBody className="grid gap-3 pt-2">
              {s.status !== 'DRAFT' ? (
                <div className="grid gap-1.5">
                  <p className="flex justify-between text-small"><span className="text-muted">{t('surveyAdmin.participation')}</span><span className="tabular-nums font-semibold">{t('surveyAdmin.answeredOf', { answered: s.answered, invited: s.invited })}</span></p>
                  <span className="block h-2.5 overflow-hidden rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={s.invited} aria-valuenow={s.answered} aria-label={t('surveyAdmin.participation')}>
                    <span className="block h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${share(s.answered, s.invited)}%` }} />
                  </span>
                </div>
              ) : <p className="text-small text-muted">{t('surveyAdmin.questionsCount', { count: s.questions.length })}</p>}
              <div className="flex flex-wrap gap-2">
                {s.status === 'DRAFT' ? (
                  <>
                    <Button size="sm" icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={busy === `pub-${s.id}`} onClick={() => act(`pub-${s.id}`, `/api/surveys/${s.id}/publish`, t('surveyAdmin.sent'))}>{t('surveyAdmin.send')}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ row: s })}>{t('common.edit')}</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} loading={busy === `del-${s.id}`} onClick={() => act(`del-${s.id}`, `/api/surveys/${s.id}`, t('surveyAdmin.deleted'), 'DELETE')}>{t('surveyAdmin.delete')}</Button>
                  </>
                ) : null}
                {s.status === 'OPEN' ? (
                  <>
                    <Button size="sm" variant="secondary" icon={<BellRing className="h-4 w-4" aria-hidden="true" />} disabled={s.remindersSent >= MAX_REMINDERS || s.answered >= s.invited} loading={busy === `rem-${s.id}`} onClick={() => act(`rem-${s.id}`, `/api/surveys/${s.id}/remind`, t('surveyAdmin.reminded'))}>{t('surveyAdmin.remind', { used: s.remindersSent, max: MAX_REMINDERS })}</Button>
                    <Button size="sm" variant="ghost" loading={busy === `close-${s.id}`} onClick={() => act(`close-${s.id}`, `/api/surveys/${s.id}/close`, t('surveyAdmin.closedOk'))}>{t('surveyAdmin.closeNow')}</Button>
                  </>
                ) : null}
                {s.status !== 'DRAFT' ? <Button size="sm" variant={s.status === 'CLOSED' ? 'primary' : 'secondary'} icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />} onClick={() => setResults(s)}>{t('surveyAdmin.results')}</Button> : null}
                {s.kind === 'PULSE' && s.status !== 'DRAFT' && choices.data?.canCreate ? <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ repeatOf: s })}>{t('surveyAdmin.repeat')}</Button> : null}
              </div>
            </CardBody>
          </Card>
        ))
      )}
      {can('tenant.configure') && can('surveys.manage') ? <SurveySettingsCard onSaved={() => void choices.reload()} /> : null}
      {editing && choices.data ? <Editor key={editing.row?.id ?? editing.repeatOf?.id ?? editing.exitFor ?? 'new'} start={editing} choices={choices.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} /> : null}
      <ResultsDialog survey={results} choices={choices.data} onClose={() => setResults(null)} />
    </div>
  );
}

type DraftQ = Omit<Question, 'id'> & { id?: string; key: string; optionsText: string };
const toDraft = (q: Omit<Question, 'id'> & { id?: string }, i: number): DraftQ => ({ ...q, key: `${q.id ?? 'q'}-${i}-${Math.random().toString(36).slice(2, 6)}`, optionsText: (q.options ?? []).join('\n') });

interface EditStart { row?: SurveyRow; repeatOf?: SurveyRow; /** A new exit survey for this offboarding. */ exitFor?: string }

function Editor({ start, choices, onClose, onSaved }: { start: EditStart; choices: Choices; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const { run, busy } = useAction();
  const base = start.row ?? start.repeatOf;
  const [kind, setKind] = useState<'PULSE' | 'EXIT'>(start.row?.kind ?? (start.exitFor ? 'EXIT' : 'PULSE'));
  const [qs, setQs] = useState<DraftQ[]>(() => (base ? base.questions : start.exitFor ? exitStarterQuestions(t) : starterQuestions(t)).map(toDraft));
  const [offboardingId, setOffboardingId] = useState(start.row?.offboardingId ?? start.exitFor ?? '');
  const [deps, setDeps] = useState<string[]>(base?.audience.departmentIds ?? []);
  const [pos, setPos] = useState<string[]>(base?.audience.positionIds ?? []);
  const offs = useQuery<Array<{ id: string; name: string; lastDay: string; hasSurvey: boolean }>>(choices.hr ? '/api/surveys-admin/offboardings' : null);
  const defaultClose = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const upd = (key: string, patch: Partial<DraftQ>) => setQs((l) => l.map((q) => (q.key === key ? { ...q, ...patch } : q)));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      kind,
      title: String(f.get('title')),
      intro: String(f.get('intro') || '') || null,
      questions: qs.map((q) => ({ ...(q.id ? { id: q.id } : {}), type: q.type, text: q.text, required: q.required, ...(q.type === 'CHOICE' || q.type === 'MULTI' ? { options: q.optionsText.split('\n').map((x) => x.trim()).filter(Boolean) } : {}) })),
      audience: { departmentIds: deps, positionIds: pos },
      closesAt: new Date(`${String(f.get('closes'))}T23:59:00`).toISOString(),
      offboardingId: kind === 'EXIT' ? offboardingId || null : null,
      repeatOf: start.repeatOf?.id ?? null,
    };
    const r = await run('save', () => api(start.row ? `/api/surveys/${start.row.id}` : '/api/surveys', { method: start.row ? 'PUT' : 'POST', body }), t('surveyAdmin.saved'));
    if (r !== undefined) onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={start.row ? t('surveyAdmin.editTitle') : start.repeatOf ? t('surveyAdmin.repeatTitle') : t('surveyAdmin.new')} description={t('surveyAdmin.draftHelp')} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-5">
        {choices.hr && !start.repeatOf ? <Segmented label={t('surveyAdmin.kindLabel')} value={kind} onChange={setKind} options={[{ value: 'PULSE', label: t('surveyAdmin.kind.PULSE') }, { value: 'EXIT', label: t('surveyAdmin.kind.EXIT') }]} /> : null}
        <p className="rounded-xl bg-surface p-3 text-small text-muted">{kind === 'PULSE' ? t('surveyAdmin.pulseHelp', { count: choices.minGroup }) : t('surveyAdmin.exitHelp')}</p>
        <Field label={t('surveyAdmin.title')}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={120} defaultValue={base?.title ?? (start.exitFor ? t('surveys.exitStarter.title') : '')} autoComplete="off" />}</Field>
        <Field label={t('surveyAdmin.intro')} hint={t('surveyAdmin.introHint')}>{(p) => <Textarea {...p} name="intro" rows={2} maxLength={1000} defaultValue={base?.intro ?? (start.exitFor ? t('surveys.exitStarter.intro') : '')} />}</Field>
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-body-strong">{t('surveyAdmin.questions')}</legend>
          {qs.map((q, i) => (
            <div key={q.key} className="grid gap-3 rounded-xl border border-line p-3">
              <div className="flex items-start gap-2">
                <span className="mt-3 text-small font-semibold tabular-nums text-muted">{i + 1}.</span>
                <Field label={t('surveyAdmin.questionText')} className="flex-1">{(p) => <Input {...p} value={q.text} onChange={(e) => upd(q.key, { text: e.target.value })} required minLength={3} maxLength={300} autoComplete="off" />}</Field>
                <button type="button" aria-label={t('surveyAdmin.removeQuestion', { n: i + 1 })} disabled={qs.length === 1} onClick={() => setQs((l) => l.filter((x) => x.key !== q.key))} className="mt-7 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface disabled:opacity-40"><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('surveyAdmin.type')}>{(p) => <Select {...p} value={q.type} onChange={(e) => upd(q.key, { type: e.target.value as QuestionType })}>{TYPES.map((x) => <option key={x} value={x}>{t(`surveyAdmin.types.${x}`)}</option>)}</Select>}</Field>
                <label className="flex items-center gap-2 self-end pb-3 text-small font-semibold"><input type="checkbox" checked={q.required} onChange={(e) => upd(q.key, { required: e.target.checked })} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('surveyAdmin.required')}</label>
              </div>
              {q.type === 'CHOICE' || q.type === 'MULTI' ? <Field label={t('surveyAdmin.options')} hint={t('surveyAdmin.optionsHint')}>{(p) => <Textarea {...p} rows={3} value={q.optionsText} onChange={(e) => upd(q.key, { optionsText: e.target.value })} required />}</Field> : null}
            </div>
          ))}
          {qs.length < 20 ? <Button type="button" size="sm" variant="secondary" className="justify-self-start" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setQs((l) => [...l, toDraft({ type: 'RATING', text: '', required: true }, l.length)])}>{t('surveyAdmin.addQuestion')}</Button> : null}
        </fieldset>
        {kind === 'PULSE' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('surveyAdmin.departments')}>{(p) => <MultiSelect id={p.id} name="deps" defaultValue={deps} options={choices.departments.map((d) => ({ value: d.id, label: nm(d, lng) }))} onChange={setDeps} placeholder={choices.hr ? t('surveyAdmin.everyone') : t('surveyAdmin.allMine')} />}</Field>
            <Field label={t('surveyAdmin.positions')}>{(p) => <MultiSelect id={p.id} name="pos" defaultValue={pos} options={choices.positions.map((x) => ({ value: x.id, label: nm(x, lng) }))} onChange={setPos} placeholder={t('surveyAdmin.allPositions')} />}</Field>
          </div>
        ) : (
          <Field label={t('surveyAdmin.leaving')} hint={t('surveyAdmin.leavingHint')}>{(p) => (
            <Select {...p} name="offboarding" required value={offboardingId} onChange={(e) => setOffboardingId(e.target.value)}>
              <option value="" disabled>{t('surveyAdmin.choosePerson')}</option>
              {(offs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name} · {formatInstant(o.lastDay.slice(0, 10), lng)}{o.hasSurvey ? ` · ${t('surveyAdmin.hasSurvey')}` : ''}</option>)}
            </Select>
          )}</Field>
        )}
        <Field label={t('surveyAdmin.closesOn')}>{(p) => <Input {...p} name="closes" type="date" required min={new Date().toISOString().slice(0, 10)} defaultValue={start.row ? start.row.closesAt.slice(0, 10) : defaultClose} className="max-w-xs" />}</Field>
        <Button type="submit" className="justify-self-start" loading={busy === 'save'}>{t('surveyAdmin.saveDraft')}</Button>
      </form>
    </Dialog>
  );
}

/** Horizontal bars in the app's chart style: label, count and share beside each bar. */
function Bars({ counts, total, label }: { counts: Record<string, number>; total: number; label: (k: string) => string }) {
  const { t, i18n } = useTranslation();
  const pct = (n: number) => `${share(n, total)}${i18n.language.startsWith('fr') ? '\u00a0%' : '%'}`;
  return (
    <ul className="grid gap-2">
      {Object.entries(counts).map(([k, n]) => (
        <li key={k}>
          <span className="flex items-baseline justify-between gap-3 text-small"><span className="min-w-0 [overflow-wrap:anywhere]">{label(k)}</span><span className="shrink-0 tabular-nums text-muted"><span className="font-semibold text-ink">{n}</span> · {pct(n)}</span></span>
          <span className="mt-1 block h-2.5 overflow-hidden rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={n} aria-label={t('surveyAdmin.barLabel', { label: label(k), n, total })}>
            <span className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${share(n, total)}%`, background: 'rgb(var(--brand-text))' }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function QuestionResult({ q }: { q: QuestionSummary }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <p className="text-body-strong">{q.text}</p>
      <p className="text-caption text-muted">{t('surveyAdmin.answeredN', { count: q.answered })}{q.average !== undefined ? ` · ${t('surveyAdmin.average', { avg: q.average.toLocaleString(i18n.language) })}` : ''}</p>
      {q.counts ? <Bars counts={q.counts} total={q.answered} label={(k) => (q.type === 'RATING' ? t('surveyAdmin.ratingLabel', { n: k }) : k)} /> : null}
      {q.type === 'TEXT' ? (
        q.texts?.length ? (
          <>
            <p className="rounded-lg bg-warn-bg p-2 text-caption text-ink">{t('surveyAdmin.styleWarning')}</p>
            <ul className="grid gap-1.5">{q.texts.map((x, i) => <li key={i} className="rounded-lg bg-surface px-3 py-2 text-small">{x}</li>)}</ul>
          </>
        ) : <p className="text-small text-muted">{t('surveyAdmin.noText')}</p>
      ) : null}
    </div>
  );
}

function ResultsDialog({ survey, choices, onClose }: { survey: SurveyRow | null; choices: Choices | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const r = useQuery<SurveyResults>(survey ? `/api/surveys/${survey.id}/results` : null);
  const tr = useQuery<TrendRow[]>(survey?.kind === 'PULSE' ? `/api/surveys/series/${survey.seriesId}/trend` : null);
  const [by, setBy] = useState<'all' | 'department' | 'position'>('all');
  useEffect(() => setBy('all'), [survey?.id]);
  async function csv() {
    const d = await apiDownload(`/api/surveys/${survey!.id}/results.csv`);
    if (d.ok) saveBlob(d.blob, `${survey!.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'survey'}.csv`);
  }
  const groupName = (kind: 'department' | 'position', id: string) => {
    const x = kind === 'department' ? choices?.departments.find((d) => d.id === id) : choices?.positions.find((p) => p.id === id);
    return x ? nm(x, lng) : t('surveyAdmin.otherGroup');
  };
  const d = r.data;
  return (
    <Dialog open={!!survey} onClose={onClose} title={survey?.title ?? ''} description={d ? t('surveyAdmin.answeredOf', { answered: d.answered, invited: d.invited }) : undefined} closeLabel={t('common.close')}>
      {!d ? <ListSkeleton /> : d.named ? (
        <div className="grid gap-4">
          <p className="rounded-xl bg-surface p-3 text-small text-muted">{t('surveyAdmin.namedNote')}</p>
          {!d.named.length ? <p className="text-small text-muted">{t('surveyAdmin.notYet')}</p> : d.named.map((n) => (
            <div key={n.name} className="grid gap-2">
              <p className="text-body-strong">{n.name}</p>
              <dl className="grid gap-2">{d.questionsAsked.map((q) => <div key={q.id}><dt className="text-small text-muted">{q.text}</dt><dd className="text-body">{[n.answers[q.id] ?? '—'].flat().join(', ')}</dd></div>)}</dl>
            </div>
          ))}
          <Button size="sm" variant="secondary" className="justify-self-start" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void csv()}>{t('surveyAdmin.csv')}</Button>
        </div>
      ) : !d.shown ? (
        <div className="grid justify-items-center gap-3 py-6 text-center">
          <Lock className="h-8 w-8 text-muted" aria-hidden="true" />
          <p className="text-body-strong">{d.reason === 'open' ? t('surveyAdmin.lockedOpen') : t('surveyAdmin.lockedFew', { count: d.minGroup })}</p>
          <p className="max-w-sm text-small text-muted">{d.reason === 'open' ? t('surveyAdmin.lockedOpenWhy') : t('surveyAdmin.lockedFewWhy')}</p>
        </div>
      ) : (
        <div className="grid gap-5">
          <Segmented label={t('surveyAdmin.view')} value={by} onChange={setBy} options={[{ value: 'all', label: t('surveyAdmin.everyoneView') }, { value: 'department', label: t('surveyAdmin.byDepartment') }, { value: 'position', label: t('surveyAdmin.byPosition') }]} />
          {by === 'all' ? d.questions!.map((q) => <QuestionResult key={q.id} q={q} />) : (
            <div className="grid gap-4">
              <p className="text-caption text-muted">{t('surveyAdmin.breakdownNote', { count: d.minGroup, hidden: d.breakdowns!.hiddenResponses[by] })}</p>
              {!d.breakdowns![by].length ? <p className="text-small text-muted">{t('surveyAdmin.noGroups')}</p> : d.breakdowns![by].map((g) => (
                <Card key={g.id}>
                  <CardHeader title={groupName(by, g.id)} description={t('surveyAdmin.answeredN', { count: g.responses })} />
                  <CardBody className="grid gap-4 pt-2">{g.questions.filter((q) => q.type !== 'TEXT').map((q) => <QuestionResult key={q.id} q={q} />)}</CardBody>
                </Card>
              ))}
            </div>
          )}
          {tr.data && tr.data.length > 1 ? <Trend rows={tr.data} /> : null}
          <Button size="sm" variant="secondary" className="justify-self-start" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void csv()}>{t('surveyAdmin.csv')}</Button>
        </div>
      )}
    </Dialog>
  );
}

/** Repeated pulses: the average of each rating question, survey by survey (1 to 5), with a table for screen readers. */
function Trend({ rows }: { rows: TrendRow[] }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const lng = i18n.language as Lng;
  const questions = rows.at(-1)!.points.map((p) => p.text);
  const W = 320;
  const H = 120;
  const x = (i: number) => (rows.length === 1 ? W / 2 : (i / (rows.length - 1)) * (W - 24) + 12);
  const y = (v: number) => H - ((v - 1) / 4) * (H - 16) - 8;
  const tones = ['rgb(var(--brand-text))', 'rgb(var(--ok))', 'rgb(var(--warn))', 'rgb(var(--muted))'];
  return (
    <section className="grid gap-2" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="text-body-strong">{t('surveyAdmin.trend')}</h3>
      <ul className="flex flex-wrap gap-3 text-caption text-muted" aria-hidden="true">{questions.map((q, i) => <li key={q} className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: tones[i % tones.length] }} />{q}</li>)}</ul>
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-1">
        <div className="relative h-32 text-right text-[0.6875rem] tabular-nums text-muted" aria-hidden="true">{[1, 2, 3, 4, 5].map((v) => <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${(y(v) / H) * 100}%` }}>{v}</span>)}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((v) => <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="rgb(var(--line))" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {questions.map((q, qi) => {
            const pts = rows.map((r, i) => ({ i, v: r.points.find((p) => p.text === q)?.average ?? null })).filter((p): p is { i: number; v: number } => p.v !== null);
            return <polyline key={q} points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke={tones[qi % tones.length]} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
          })}
        </svg>
      </div>
      <div className="flex justify-between pl-6 text-caption text-muted" aria-hidden="true">{rows.map((r) => <span key={r.id}>{formatInstant(r.opensAt, lng, 'short')}</span>)}</div>
      <table className="sr-only">
        <caption>{t('surveyAdmin.trend')}</caption>
        <thead><tr><th>{t('surveyAdmin.survey')}</th>{questions.map((q) => <th key={q}>{q}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{formatInstant(r.opensAt, lng)}</td>{questions.map((q) => <td key={q}>{r.points.find((p) => p.text === q)?.average ?? t('surveyAdmin.hiddenCell')}</td>)}</tr>)}</tbody>
      </table>
    </section>
  );
}

function SurveySettingsCard({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const q = useQuery<{ minGroup: number; managersCreate: boolean; limits: [number, number] }>('/api/surveys-admin/settings');
  const { run, busy } = useAction();
  if (!q.data) return null;
  const s = q.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('save', () => api('/api/surveys-admin/settings', { method: 'PUT', body: { minGroup: Number(f.get('minGroup')), managersCreate: f.get('managersCreate') === 'on' } }), t('surveyAdmin.settingsSaved'));
    if (r !== undefined) { await q.reload(); onSaved(); }
  }
  return (
    <Card>
      <CardHeader title={t('surveyAdmin.settingsTitle')} description={t('surveyAdmin.settingsHelp')} />
      <CardBody className="pt-2">
        <form key={JSON.stringify(s)} onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field label={t('surveyAdmin.minGroup')} hint={t('surveyAdmin.minGroupHint', { min: s.limits[0], max: s.limits[1] })}>{(p) => <Input {...p} name="minGroup" type="number" min={s.limits[0]} max={s.limits[1]} defaultValue={s.minGroup} required className="max-w-[8rem]" />}</Field>
          <label className="flex items-start gap-3 text-small"><input type="checkbox" name="managersCreate" defaultChecked={s.managersCreate} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" /><span><span className="font-semibold text-ink">{t('surveyAdmin.managersCreate')}</span><span className="block text-muted">{t('surveyAdmin.managersCreateHelp')}</span></span></label>
          <Button type="submit" size="sm" className="justify-self-start" loading={busy === 'save'}>{t('common.save')}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
