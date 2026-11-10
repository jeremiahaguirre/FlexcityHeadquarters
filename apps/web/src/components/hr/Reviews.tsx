'use client';

import { ClipboardCheck, Plus, Star } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Review, ReviewStatus } from '@/lib/hr';
import { todayIso, useAction, useQuery } from '@/lib/useQuery';

const TONE: Record<ReviewStatus, Tone> = { SELF: 'neutral', MANAGER: 'neutral', DISCUSS: 'brand', ACKNOWLEDGED: 'ok' };

function Stars({ n }: { n: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t('reviews.ratingOf', { n })}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-4 w-4 ${i <= n ? 'fill-current text-brand-text' : 'text-line'}`} aria-hidden="true" />)}
    </span>
  );
}

/** A review, with the step the signed-in person can take on it. */
function ReviewDetail({ r, onDone }: { r: Review; onDone: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [met, setMet] = useState<Array<boolean | null>>(r.goals.map((g) => g.met));
  async function act(e: FormEvent<HTMLFormElement>, step: 'self' | 'manager' | 'acknowledge') {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const call =
      step === 'self'
        ? () => api(`/api/reviews/${r.id}/self`, { method: 'PUT', body: { selfComments: s('text') } })
        : step === 'manager'
          ? () => api(`/api/reviews/${r.id}/manager`, { method: 'PUT', body: { managerComments: s('text'), rating: Number(f.get('rating')), goalsMet: met } })
          : () => api(`/api/reviews/${r.id}/acknowledge`, { method: 'POST', body: { employeeComments: s('text') || null } });
    const out = await run(step, call, t(`reviews.done.${step}`));
    if (out !== undefined) await onDone();
  }
  const section = (title: string, body: string | null) => (body ? <div><p className="text-caption font-semibold uppercase tracking-wide text-muted">{title}</p><p className="whitespace-pre-wrap">{body}</p></div> : null);
  return (
    <div className="grid gap-4 text-small">
      <p className="flex flex-wrap items-center gap-2"><StatusPill tone={TONE[r.status]}>{t(`reviews.status.${r.status}`)}</StatusPill>{t('reviews.meta', { employee: r.employee, reviewer: r.reviewer, due: formatDate(r.dueOn, i18n.language, 'dated') })}</p>
      {r.goals.length ? (
        <div>
          <p className="text-caption font-semibold uppercase tracking-wide text-muted">{t('reviews.goals')}</p>
          <ul className="grid gap-1">
            {r.goals.map((g, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span>{g.text}</span>
                {r.reviewing && r.status === 'MANAGER' ? (
                  <Select aria-label={t('reviews.goalMet', { goal: g.text })} value={met[i] == null ? '' : met[i] ? 'yes' : 'no'} onChange={(e) => setMet(met.map((m, j) => (j === i ? (e.target.value === '' ? null : e.target.value === 'yes') : m)))} className="w-36">
                    <option value="">{t('reviews.metUnset')}</option>
                    <option value="yes">{t('reviews.metYes')}</option>
                    <option value="no">{t('reviews.metNo')}</option>
                  </Select>
                ) : g.met != null ? <StatusPill tone={g.met ? 'ok' : 'warn'}>{g.met ? t('reviews.metYes') : t('reviews.metNo')}</StatusPill> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {section(t('reviews.self'), r.selfComments)}
      {r.managerComments ? <div className="grid gap-1">{section(t('reviews.manager'), r.managerComments)}{r.rating ? <Stars n={r.rating} /> : null}</div> : null}
      {section(t('reviews.employeeSide'), r.employeeComments)}
      {r.mine && r.status === 'SELF' ? (
        <form onSubmit={(e) => void act(e, 'self')} className="grid gap-3">
          <Field label={t('reviews.selfPrompt')}>{(p) => <Textarea {...p} name="text" required minLength={2} maxLength={5000} rows={5} />}</Field>
          <div><Button type="submit" loading={busy === 'self'}>{t('reviews.sendSelf')}</Button></div>
        </form>
      ) : null}
      {r.reviewing && r.status === 'MANAGER' ? (
        <form onSubmit={(e) => void act(e, 'manager')} className="grid gap-3">
          <Field label={t('reviews.managerPrompt')}>{(p) => <Textarea {...p} name="text" required minLength={2} maxLength={5000} rows={5} />}</Field>
          <Field label={t('reviews.rating')}>{(p) => <Select {...p} name="rating" required defaultValue="3">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{t(`reviews.ratings.${n}`)}</option>)}</Select>}</Field>
          <div><Button type="submit" loading={busy === 'manager'}>{t('reviews.sendManager')}</Button></div>
        </form>
      ) : null}
      {r.mine && r.status === 'DISCUSS' ? (
        <form onSubmit={(e) => void act(e, 'acknowledge')} className="grid gap-3">
          <p className="text-muted">{t('reviews.ackHelp')}</p>
          <Field label={t('reviews.ackComments')}>{(p) => <Textarea {...p} name="text" maxLength={5000} rows={3} />}</Field>
          <div><Button type="submit" loading={busy === 'acknowledge'}>{t('reviews.acknowledge')}</Button></div>
        </form>
      ) : null}
    </div>
  );
}

function ReviewList({ rows, onOpen }: { rows: Review[]; onOpen: (r: Review) => void }) {
  const { t, i18n } = useTranslation();
  const today = todayIso();
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-2 py-3 text-left hover:bg-surface">
            <span>
              <span className="block text-body-strong">{r.mine ? r.cycle : `${r.employee} · ${r.cycle}`}</span>
              <span className={`text-caption ${r.status !== 'ACKNOWLEDGED' && r.dueOn < today ? 'text-danger' : 'text-muted'}`}>{t('reviews.dueLine', { reviewer: r.reviewer, due: formatDate(r.dueOn, i18n.language, 'dated') })}</span>
            </span>
            <StatusPill tone={TONE[r.status]}>{t(`reviews.status.${r.status}`)}</StatusPill>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** On the profile: my reviews, and reviews I'm conducting. */
export function MyReviews() {
  const { t } = useTranslation();
  const data = useQuery<Review[]>('/api/me/reviews');
  const [open, setOpen] = useState<Review | null>(null);
  if (data.error || !data.data?.length) return null;
  return (
    <Card id="reviews">
      <CardHeader title={t('reviews.myTitle')} description={t('reviews.myHelp')} />
      <CardBody className="pt-2"><ReviewList rows={data.data} onOpen={setOpen} /></CardBody>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.cycle ?? ''}>
        {open ? <ReviewDetail r={open} onDone={async () => { setOpen(null); await data.reload(); }} /> : null}
      </Dialog>
    </Card>
  );
}

/** HR: every review, and starting new ones. */
export function ReviewsPanel() {
  const { t } = useTranslation();
  const data = useQuery<Review[]>('/api/reviews');
  const people = useQuery<Array<{ id: string; name: string }>>('/api/users');
  const [open, setOpen] = useState<Review | null>(null);
  const [adding, setAdding] = useState(false);
  const { run, busy } = useAction();
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const goals = String(f.get('goals') ?? '').split('\n').map((g) => g.trim()).filter((g) => g.length >= 2);
    const r = await run('new', () => api('/api/reviews', { method: 'POST', body: { userId: f.get('userId'), reviewerId: f.get('reviewerId'), cycle: String(f.get('cycle')).trim(), dueOn: f.get('dueOn'), goals } }), t('reviews.created'));
    if (r !== undefined) {
      setAdding(false);
      await data.reload();
    }
  }
  return (
    <Card>
      <CardHeader title={t('reviews.title')} description={t('reviews.help')} action={<Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('reviews.start')}</Button>} />
      <CardBody className="pt-2">
        {!data.data ? <Skeleton className="h-40" /> : !data.data.length ? <EmptyState icon={ClipboardCheck} title={t('reviews.none')}>{t('reviews.noneHelp')}</EmptyState> : <ReviewList rows={data.data} onOpen={setOpen} />}
      </CardBody>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `${open.employee} · ${open.cycle}` : ''}>
        {open ? <ReviewDetail r={open} onDone={async () => { setOpen(null); await data.reload(); }} /> : null}
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('reviews.start')}>
        <form onSubmit={(e) => void create(e)} className="grid gap-3">
          <Field label={t('reviews.employee')}>{(p) => <Select {...p} name="userId" required>{(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field>
          <Field label={t('reviews.reviewer')}>{(p) => <Select {...p} name="reviewerId" required>{(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('reviews.cycle')}>{(p) => <Input {...p} name="cycle" required minLength={2} maxLength={60} defaultValue={t('reviews.cycleDefault', { year: new Date().getFullYear() })} />}</Field>
            <Field label={t('reviews.due')}>{(p) => <Input {...p} name="dueOn" type="date" required />}</Field>
          </div>
          <Field label={t('reviews.goals')} hint={t('reviews.goalsHint')}>{(p) => <Textarea {...p} name="goals" rows={4} />}</Field>
          <div><Button type="submit" loading={busy === 'new'}>{t('reviews.create')}</Button></div>
        </form>
      </Dialog>
    </Card>
  );
}
