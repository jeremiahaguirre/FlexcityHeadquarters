'use client';

import { Award, CalendarX2, ClipboardPen, Clock, FileText, MessageSquareWarning, Plus, Scale, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { CATEGORIES, type CaseFile, type FileEvent, type FileNote, type FileRecord, LEVELS, type Level, SERIOUS, dayOf, recentFacts, requiredChecks } from '@/lib/people';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

type Item = { at: string; key: string; node: ReactNode };
const toLocalInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => new Date(v).toISOString();

export function scoreTone(score: number) {
  return score >= 85 ? 'ok' : score >= 70 ? 'neutral' : 'warn';
}

/** One person's case file for HR and supervisors: facts, flags, and the actions that document them. */
export function CaseFilePanel({ userId, name, unionMember }: { userId: string; name: string; unionMember: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const file = useQuery<CaseFile>(`/api/users/${userId}/case-file`);
  const incidents = useQuery<Array<{ id: string; category: string; localOccurredAt: string; facility: { name: string } }>>(
    can('incidents.read') ? `/api/incidents?from=${new Date(Date.now() - 60 * 86_400_000).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}` : null,
  );
  const { run, busy } = useAction();
  const [dialog, setDialog] = useState<'attendance' | 'note' | 'record' | null>(null);
  const [reasonFor, setReasonFor] = useState<{ kind: 'excuse' | 'retract'; id: string } | null>(null);
  const f = file.data;
  const write = can('reliability.write');
  const date = (iso: string) => formatDate(dayOf(iso), lng, 'dated');

  const items = useMemo<Item[]>(() => {
    if (!f) return [];
    const ev = (e: FileEvent): Item => ({
      at: e.occurredAt,
      key: `e${e.id}`,
      node: (
        <Row
          icon={e.type === 'NO_SHOW' || e.type === 'MISSED_IN_SERVICE' ? <CalendarX2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          title={t(`profile.events.${e.type}`)}
          meta={`${date(e.occurredAt)} · ${t(`people.source.${e.source}`)}`}
          tail={
            e.counted ? (
              <span className={`tabular-nums text-small font-semibold ${e.points < 0 ? 'text-warn' : 'text-ok'}`}>{e.points > 0 ? `+${e.points}` : e.points}</span>
            ) : (
              <StatusPill tone="neutral">{t('people.excused')}</StatusPill>
            )
          }
          muted={!e.counted}
        >
          {e.note ? <p>{e.note}</p> : null}
          {e.excludedReason ? <p className="text-muted">{t('people.excusedBecause', { reason: e.excludedReason })}</p> : null}
          {write && e.counted && e.points < 0 ? (
            <button type="button" className="mt-1 justify-self-start text-caption font-semibold text-brand-text hover:underline" onClick={() => setReasonFor({ kind: 'excuse', id: e.id })}>
              {t('people.excuse')}
            </button>
          ) : null}
        </Row>
      ),
    });
    const note = (n: FileNote): Item => ({
      at: n.occurredAt,
      key: `n${n.id}`,
      node: (
        <Row
          icon={n.category === 'COMMENDATION' ? <Award className="h-4 w-4" /> : <MessageSquareWarning className="h-4 w-4" />}
          title={t(`people.category.${n.category}`)}
          meta={`${date(n.occurredAt)} · ${n.recordedBy}${n.incidentId ? ` · ${t('people.fromIncident')}` : ''}`}
          tail={n.retractedAt ? <StatusPill tone="neutral">{t('people.retracted')}</StatusPill> : n.category === 'COMMENDATION' ? <StatusPill tone="ok">{t('people.commendation')}</StatusPill> : null}
          muted={!!n.retractedAt}
        >
          <p className="whitespace-pre-wrap">{n.summary}</p>
          {n.retractedReason ? <p className="text-muted">{t('people.retractedBecause', { reason: n.retractedReason })}</p> : null}
          {write && !n.retractedAt ? (
            <button type="button" className="mt-1 justify-self-start text-caption font-semibold text-brand-text hover:underline" onClick={() => setReasonFor({ kind: 'retract', id: n.id })}>
              {t('people.retract')}
            </button>
          ) : null}
        </Row>
      ),
    });
    const rec = (r: FileRecord): Item => ({ at: r.issuedAt, key: `r${r.id}`, node: <RecordRow r={r} /> });
    return [...f.events.map(ev), ...f.notes.map(note), ...f.records.map(rec)].sort((a, b) => b.at.localeCompare(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, lng, write]);

  if (file.error) return null;
  if (!f) return <Skeleton className="h-64" />;
  const { review } = f;

  return (
    <Card id="case-file" className="lg:col-span-2">
      <CardHeader
        title={t('people.caseFile')}
        description={t('people.caseFileHelp')}
        action={
          <div className="flex flex-wrap gap-2">
            {write ? (
              <>
                <Button size="sm" variant="secondary" icon={<CalendarX2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('attendance')}>
                  {t('people.recordAttendance')}
                </Button>
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('note')}>
                  {t('people.addNote')}
                </Button>
              </>
            ) : null}
            {can('discipline.write') ? (
              <Button size="sm" icon={<ClipboardPen className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('record')}>
                {t('people.startRecord')}
              </Button>
            ) : null}
          </div>
        }
      />
      <CardBody className="grid gap-6 pt-3 lg:grid-cols-[18rem_1fr]">
        <div className="grid content-start gap-4">
          <div className="rounded-2xl bg-surface p-4">
            <p className="text-label uppercase text-muted">{t('profile.reliability')}</p>
            <div className="mt-1 flex items-end gap-2">
              <p className="text-stat tabular-nums">{f.score}</p>
              <StatusPill tone={scoreTone(f.score)} className="mb-2">
                {t('profile.outOf100')}
              </StatusPill>
            </div>
            {review.commendations90 ? <p className="mt-1 flex items-center gap-1.5 text-small text-ok"><Award className="h-4 w-4" aria-hidden="true" />{t('people.commendations', { count: review.commendations90 })}</p> : null}
          </div>
          {review.flags.length ? (
            <div className="rounded-2xl border border-warn/40 bg-warn-bg/50 p-4">
              <p className="text-small font-semibold">{t('people.whyFlagged')}</p>
              <ul className="mt-2 grid gap-1.5 text-small">
                {review.flags.map((fl) => (
                  <li key={fl.code}>• {t(`people.flags.${fl.code}`, fl)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-2xl bg-ok-bg px-4 py-3 text-small text-ok">{t('people.noFlags')}</p>
          )}
          <dl className="grid gap-2 text-small">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t('people.activeLevel')}</dt>
              <dd className="font-semibold">{review.activeLevel ? t(`people.level.${review.activeLevel}`) : t('people.none')}</dd>
            </div>
            {review.suggestedLevel ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t('people.typicalNext')}</dt>
                <dd className="font-semibold text-brand-text">{t(`people.level.${review.suggestedLevel}`)}</dd>
              </div>
            ) : null}
          </dl>
          {review.hasExclusions ? <p className="text-caption text-muted">{t('people.exclusionsNote')}</p> : null}
          <p className="flex gap-2 text-caption text-muted">
            <Scale className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('people.advisory')}
          </p>
        </div>
        <div className="min-w-0">
          {items.length ? <ol className="grid gap-2">{items.map((i) => <li key={i.key}>{i.node}</li>)}</ol> : <p className="text-small text-muted">{t('people.empty')}</p>}
        </div>
      </CardBody>

      <Dialog open={dialog === 'attendance'} onClose={() => setDialog(null)} title={t('people.recordAttendance')} description={t('people.recordAttendanceHelp', { name })} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void run('att', () => api(`/api/users/${userId}/reliability/events`, { method: 'POST', body: { type: d.get('type'), occurredAt: fromLocalInput(String(d.get('at'))), note: d.get('note') } }), t('people.saved')).then((ok) => {
              if (ok !== undefined) {
                setDialog(null);
                void file.reload();
              }
            });
          }}
        >
          <Field label={t('people.what')}>
            {(p) => (
              <Select {...p} name="type" required>
                <option value="NO_SHOW">{t('profile.events.NO_SHOW')}</option>
                <option value="MISSED_IN_SERVICE">{t('profile.events.MISSED_IN_SERVICE')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('people.when')}>{(p) => <Input {...p} name="at" type="datetime-local" defaultValue={toLocalInput()} required />}</Field>
          <Field label={t('people.factualNote')} hint={t('people.factualHint')}>{(p) => <Textarea {...p} name="note" required minLength={5} maxLength={1000} />}</Field>
          <Button type="submit" loading={busy === 'att'}>{t('people.save')}</Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'note'} onClose={() => setDialog(null)} title={t('people.addNote')} description={t('people.addNoteHelp', { name })} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void run('note', () => api(`/api/users/${userId}/conduct-notes`, { method: 'POST', body: { category: d.get('category'), summary: d.get('summary'), occurredAt: fromLocalInput(String(d.get('at'))), incidentId: d.get('incident') || null } }), t('people.saved')).then((ok) => {
              if (ok !== undefined) {
                setDialog(null);
                void file.reload();
              }
            });
          }}
        >
          <Field label={t('people.kind')}>
            {(p) => (
              <Select {...p} name="category" required>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`people.category.${c}`)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('people.when')}>{(p) => <Input {...p} name="at" type="datetime-local" defaultValue={toLocalInput()} required />}</Field>
          {incidents.data?.length ? (
            <Field label={t('people.relatedIncident')} hint={t('people.relatedIncidentHint')}>
              {(p) => (
                <Select {...p} name="incident">
                  <option value="">{t('people.noIncident')}</option>
                  {incidents.data!.map((i) => (
                    <option key={i.id} value={i.id}>{`${formatDate(i.localOccurredAt, lng, 'dated')} · ${i.facility.name} · ${t(`incidents.categories.${i.category}`, { defaultValue: i.category })}`}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t('people.whatHappened')} hint={t('people.factualHint')}>{(p) => <Textarea {...p} name="summary" required minLength={10} maxLength={2000} className="min-h-[8rem]" />}</Field>
          <Button type="submit" loading={busy === 'note'}>{t('people.save')}</Button>
        </form>
      </Dialog>

      <Dialog open={!!reasonFor} onClose={() => setReasonFor(null)} title={reasonFor?.kind === 'excuse' ? t('people.excuse') : t('people.retract')} description={reasonFor?.kind === 'excuse' ? t('people.excuseHelp') : t('people.retractHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get('reason'));
            const path = reasonFor!.kind === 'excuse' ? `/api/reliability-events/${reasonFor!.id}/excuse` : `/api/conduct-notes/${reasonFor!.id}/retract`;
            void run('reason', () => api(path, { method: 'POST', body: { reason } }), t('people.saved')).then((ok) => {
              if (ok !== undefined) {
                setReasonFor(null);
                void file.reload();
              }
            });
          }}
        >
          <Field label={t('people.reason')} hint={t('people.reasonHint')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={300} />}</Field>
          <Button type="submit" loading={busy === 'reason'}>{t('people.save')}</Button>
        </form>
      </Dialog>

      {dialog === 'record' ? <RecordDialog file={f} userId={userId} name={name} unionMember={unionMember} onClose={() => setDialog(null)} onSaved={() => void file.reload()} /> : null}
    </Card>
  );
}

function Row({ icon, title, meta, tail, muted, children }: { icon: ReactNode; title: string; meta: string; tail?: ReactNode; muted?: boolean; children?: ReactNode }) {
  return (
    <div className={`flex gap-3 rounded-xl border border-line px-4 py-3 text-small ${muted ? 'bg-surface/60 opacity-80' : 'bg-panel'}`}>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-muted" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{title}</p>
            <p className="text-caption text-muted">{meta}</p>
          </div>
          {tail}
        </div>
        {children ? <div className="mt-1.5 grid gap-1">{children}</div> : null}
      </div>
    </div>
  );
}

export function RecordRow({ r }: { r: FileRecord }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  return (
    <Row
      icon={<FileText className="h-4 w-4" />}
      title={r.level ? t(`people.level.${r.level}`) : t('people.record')}
      meta={`${formatDate(dayOf(r.issuedAt), lng, 'dated')}${r.stewardPresent ? ` · ${t('people.stewardWasPresent')}` : ''}`}
      tail={<StatusPill tone={r.acknowledgedAt ? 'ok' : 'neutral'}>{r.acknowledgedAt ? t('staff.signed') : t('staff.notSigned')}</StatusPill>}
    >
      <p className="whitespace-pre-wrap">{r.summary}</p>
      {r.evidence?.length ? <p className="text-caption text-muted">{t('people.reliesOn', { count: r.evidence.length })}</p> : null}
      {r.employeeResponse ? (
        <blockquote className="mt-1 rounded-lg border-l-4 border-brand/40 bg-surface px-3 py-2">
          <p className="text-caption font-semibold text-muted">{t('people.employeeResponse')}</p>
          <p className="whitespace-pre-wrap">{r.employeeResponse}</p>
        </blockquote>
      ) : null}
    </Row>
  );
}

/** Start a record: level, the facts relied on, a drafted summary, and the fair-process steps. */
function RecordDialog({ file, userId, name, unionMember, onClose, onSaved }: { file: CaseFile; userId: string; name: string; unionMember: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const facts = useMemo(() => recentFacts(file), [file]);
  const [level, setLevel] = useState<Level>(file.review.suggestedLevel ?? 'COACHING');
  const [events, setEvents] = useState<Set<string>>(new Set(facts.events.map((e) => e.id)));
  const [notes, setNotes] = useState<Set<string>>(new Set(facts.notes.map((n) => n.id)));
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [steward, setSteward] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const date = (iso: string) => formatDate(dayOf(iso), lng, 'dated');
  const draft = () =>
    t('people.draft', {
      name,
      level: t(`people.level.${level}`),
      facts: [
        ...facts.events.filter((e) => events.has(e.id)).map((e) => `• ${t(`profile.events.${e.type}`)}, ${date(e.occurredAt)}${e.note ? `: ${e.note}` : ''}`),
        ...facts.notes.filter((n) => notes.has(n.id)).map((n) => `• ${t(`people.category.${n.category}`)}, ${date(n.occurredAt)}: ${n.summary}`),
      ].join('\n') || t('people.draftNoFacts'),
    });
  const [summary, setSummary] = useState(draft);
  const [edited, setEdited] = useState(false);
  // Keep the draft in step with the level and facts until HR starts writing.
  useEffect(() => {
    if (!edited) setSummary(draft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, events, notes]);
  const needed = requiredChecks(level, unionMember);
  const serious = SERIOUS.has(level);
  const allowed = LEVELS.filter((l) => !SERIOUS.has(l) || can('users.write'));
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  async function save() {
    setMissing([]);
    setSaving(true);
    try {
      await api(`/api/users/${userId}/discipline`, {
        method: 'POST',
        body: { summary, level, stewardPresent: steward, evidence: { events: [...events], notes: [...notes] }, fairProcess: checks },
      });
      toast(t('staff.recordSaved'), 'ok');
      onSaved();
      onClose();
    } catch (e) {
      const m = e instanceof ApiError ? (e.details as { missing?: string[] } | undefined)?.missing : undefined;
      if (m) setMissing(m);
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('people.startRecord')}
      description={t('people.startRecordHelp', { name })}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={saving} disabled={needed.some((c) => !checks[c]) || (serious && events.size + notes.size === 0)} onClick={() => void save()}>
            {t('staff.saveRecord')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('people.levelLabel')} hint={file.review.suggestedLevel ? t('people.levelHint', { level: t(`people.level.${file.review.suggestedLevel}`) }) : undefined}>
          {(p) => (
            <Select {...p} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              {allowed.map((l) => (
                <option key={l} value={l}>{t(`people.level.${l}`)}</option>
              ))}
            </Select>
          )}
        </Field>

        {LEVELS.indexOf(level) > LEVELS.indexOf(file.review.suggestedLevel ?? 'COACHING') ? (
          <p className="-mt-2 rounded-xl bg-warn-bg px-3 py-2 text-small text-warn">{t('people.skipsSteps')}</p>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-small font-semibold">{t('people.factsRelied')}</legend>
          {!facts.events.length && !facts.notes.length ? <p className="text-small text-muted">{t('people.noRecentFacts')}</p> : null}
          {facts.events.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-small">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={events.has(e.id)} onChange={() => setEvents((s) => toggle(s, e.id))} />
              <span>{t(`profile.events.${e.type}`)} · {date(e.occurredAt)}{e.note ? ` · ${e.note}` : ''}</span>
            </label>
          ))}
          {facts.notes.map((n) => (
            <label key={n.id} className="flex items-start gap-2 text-small">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={notes.has(n.id)} onChange={() => setNotes((s) => toggle(s, n.id))} />
              <span>{t(`people.category.${n.category}`)} · {date(n.occurredAt)} · {n.summary}</span>
            </label>
          ))}
        </fieldset>

        <Field label={t('staff.summary')} hint={t('people.summaryHint')}>
          {(p) => (
            <>
              <Textarea {...p} value={summary} onChange={(e) => { setSummary(e.target.value); setEdited(true); }} required minLength={10} maxLength={4000} rows={14} />
              <button type="button" className="mt-1 justify-self-start text-caption font-semibold text-brand-text hover:underline" onClick={() => { setSummary(draft()); setEdited(false); }}>
                <Undo2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                {t('people.redraft')}
              </button>
            </>
          )}
        </Field>

        <label className="flex items-center gap-2 text-small font-semibold">
          <input type="checkbox" checked={steward} onChange={(e) => setSteward(e.target.checked)} className="h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
          {t('staff.stewardPresent')}
        </label>

        {needed.length ? (
          <fieldset className="grid gap-2 rounded-2xl border border-warn/40 bg-warn-bg/40 p-4">
            <legend className="px-1 text-small font-semibold">{t('people.fairProcess')}</legend>
            <p className="text-caption text-muted">{t('people.fairProcessHelp')}</p>
            {needed.map((c) => (
              <label key={c} className={`flex items-start gap-2 text-small ${missing.includes(c) ? 'text-danger' : ''}`}>
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={!!checks[c]} onChange={(e) => setChecks((s) => ({ ...s, [c]: e.target.checked }))} />
                <span>{t(`people.checks.${c}`)}</span>
              </label>
            ))}
            {serious && events.size + notes.size === 0 ? <p className="text-caption text-danger">{t('people.attachFacts')}</p> : null}
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}
