'use client';

import { CheckCircle2, ClipboardPen, EyeOff, UserRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Textarea } from '@/components/ui/Field';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatInstant } from '@/lib/format';
import { type Answer, type MySurvey, missingRequired } from '@/lib/surveys';
import { useAction, useQuery } from '@/lib/useQuery';

/** Surveys waiting for this person. Before any question: what happens to the answers. */
export function MySurveys() {
  const { t } = useTranslation();
  const q = useQuery<MySurvey[]>('/api/me/surveys');
  const focus = useSearchParams().get('s');
  if (q.loading) return <ListSkeleton />;
  if (!q.data?.length) return <EmptyState icon={ClipboardPen} title={t('surveys.noneTitle')}>{t('surveys.noneBody')}</EmptyState>;
  const list = [...q.data].sort((a, b) => Number(b.id === focus) - Number(a.id === focus));
  return (
    <div className="grid max-w-2xl gap-6">
      {list.map((s) => <SurveyCard key={s.id} s={s} onDone={() => void q.reload()} />)}
    </div>
  );
}

function SurveyCard({ s, onDone }: { s: MySurvey; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const set = (id: string, v: Answer | undefined) => setAnswers((a) => ({ ...a, [id]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = missingRequired(s.questions, answers);
    setMissing(m);
    if (m.length) return document.getElementById(`q-${s.id}-${m[0]}`)?.focus();
    const r = await run('send', () => api(`/api/me/surveys/${s.id}/answers`, { method: 'POST', body: { answers } }), t('surveys.thanks'));
    if (r !== undefined) onDone();
  }

  return (
    <Card>
      <CardHeader
        title={s.title}
        description={t('surveys.closes', { date: formatInstant(s.closesAt, i18n.language as 'en-CA') })}
        action={s.responded ? <StatusPill tone="ok" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>{t('surveys.answered')}</StatusPill> : null}
      />
      <CardBody className="grid gap-5 pt-2">
        {s.intro ? <p className="whitespace-pre-wrap text-body text-ink">{s.intro}</p> : null}
        <div className={cn('flex gap-3 rounded-xl border p-3 text-small', s.anonymous ? 'border-brand/30 bg-brand/5' : 'border-warn/40 bg-warn-bg')}>
          {s.anonymous ? <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" /> : <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />}
          <div className="grid gap-1">
            <p className="font-semibold text-ink">{s.anonymous ? t('surveys.promiseTitle') : t('surveys.namedTitle')}</p>
            {s.anonymous ? (
              <ul className="grid list-disc gap-0.5 pl-4 text-muted">
                <li>{t('surveys.promise1')}</li>
                <li>{t('surveys.promise2', { count: s.minGroup })}</li>
                <li>{t('surveys.promise3')}</li>
              </ul>
            ) : <p className="text-muted">{t('surveys.namedBody')}</p>}
          </div>
        </div>
        {s.responded ? <p className="text-small text-muted">{t('surveys.alreadyDone')}</p> : !started ? (
          <Button className="justify-self-start" onClick={() => setStarted(true)}>{t('surveys.start', { count: s.questions.length })}</Button>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="grid gap-6" noValidate>
            {s.questions.map((q, i) => {
              const err = missing.includes(q.id);
              const legend = `${i + 1}. ${q.text}${q.required ? '' : ` ${t('surveys.optional')}`}`;
              return (
                <fieldset key={q.id} className="grid gap-2" aria-invalid={err || undefined} aria-describedby={err ? `q-${s.id}-${q.id}-err` : undefined}>
                  <legend className="mb-1 text-body-strong text-ink">{legend}</legend>
                  {q.type === 'RATING' ? (
                    <div className="grid gap-1">
                      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={q.text}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n} className={cn('grid h-12 cursor-pointer place-items-center rounded-xl border text-body-strong transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand', answers[q.id] === n ? 'border-brand bg-brand text-brand-contrast' : 'border-line bg-panel hover:bg-surface')}>
                            <input id={n === 1 ? `q-${s.id}-${q.id}` : undefined} type="radio" name={q.id} value={n} className="sr-only" checked={answers[q.id] === n} onChange={() => set(q.id, n)} />
                            {n}
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-between text-caption text-muted" aria-hidden="true"><span>{t('surveys.low')}</span><span>{t('surveys.high')}</span></div>
                    </div>
                  ) : q.type === 'TEXT' ? (
                    <>
                      <Textarea id={`q-${s.id}-${q.id}`} aria-label={q.text} rows={3} maxLength={1000} value={(answers[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                      {s.anonymous ? <p className="text-caption text-muted">{t('surveys.styleWarning')}</p> : null}
                    </>
                  ) : (
                    <div className="grid gap-1.5">
                      {q.options!.map((o, k) => {
                        const multi = q.type === 'MULTI';
                        const cur = answers[q.id];
                        const on = multi ? Array.isArray(cur) && cur.includes(o) : cur === o;
                        return (
                          <label key={o} className={cn('flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-xl border px-3 text-body', on ? 'border-brand bg-brand/10' : 'border-line hover:bg-surface')}>
                            <input
                              id={k === 0 ? `q-${s.id}-${q.id}` : undefined}
                              type={multi ? 'checkbox' : 'radio'}
                              name={q.id}
                              checked={on}
                              onChange={() => set(q.id, multi ? (on ? (cur as string[]).filter((x) => x !== o) : [...((cur as string[]) ?? []), o]) : o)}
                              className="h-5 w-5 shrink-0 accent-[rgb(var(--brand))]"
                            />
                            {o}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {err ? <p id={`q-${s.id}-${q.id}-err`} role="alert" className="text-small text-warn">{t('surveys.needsAnswer')}</p> : null}
                </fieldset>
              );
            })}
            <Button type="submit" className="justify-self-start" loading={busy === 'send'}>{t('surveys.send')}</Button>
            <p className="text-caption text-muted">{t('surveys.onceOnly')}</p>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
