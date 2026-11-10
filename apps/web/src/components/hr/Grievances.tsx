'use client';

import { Plus, Scale } from 'lucide-react';
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
import { GRIEVANCE_STATUSES, type Grievance, type GrievanceStatus } from '@/lib/hr';
import { todayIso, useAction, useQuery } from '@/lib/useQuery';

const tone = (s: GrievanceStatus): Tone => (s === 'RESOLVED' ? 'ok' : s === 'WITHDRAWN' ? 'neutral' : s === 'ARBITRATION' ? 'danger' : 'warn');

/** Labour relations: the grievance log, each with its step, deadline and history. */
export function GrievancesPanel() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<Grievance[]>('/api/grievances');
  const people = useQuery<Array<{ id: string; name: string }>>('/api/users');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Grievance | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const { run, busy } = useAction();
  const today = todayIso();

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const r = await run('new', () => api('/api/grievances', { method: 'POST', body: { userId: s('userId') || null, kind: s('kind'), title: s('title'), articles: s('articles') || null, filedOn: s('filedOn'), dueOn: s('dueOn') || null } }), t('grievances.created'));
    if (r !== undefined) {
      setAdding(false);
      await data.reload();
    }
  }
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!open) return;
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const r = await run('upd', () => api(`/api/grievances/${open.id}`, { method: 'PATCH', body: { status: s('status'), dueOn: s('dueOn') || null, outcome: s('outcome') || null, note: s('note') || null } }), t('grievances.updated'));
    if (r !== undefined) {
      setOpen(null);
      await data.reload();
    }
  }
  const rows = (data.data ?? []).filter((g) => showClosed || !['RESOLVED', 'WITHDRAWN'].includes(g.status));
  return (
    <Card>
      <CardHeader
        title={t('grievances.title')}
        description={t('grievances.help')}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('grievances.showClosed')}</label>
            <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('grievances.file')}</Button>
          </div>
        }
      />
      <CardBody className="pt-2">
        {!data.data ? (
          <Skeleton className="h-40" />
        ) : !rows.length ? (
          <EmptyState icon={Scale} title={t('grievances.none')}>{t('grievances.noneHelp')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => setOpen(g)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-2 py-3 text-left hover:bg-surface">
                  <span>
                    <span className="block text-body-strong">#{g.number} · {g.title}</span>
                    <span className="text-caption text-muted">{[g.grievor ?? t(`grievances.kinds.${g.kind}`), g.articles ? t('grievances.articlesLine', { articles: g.articles }) : '', t('grievances.filed', { date: formatDate(g.filedOn, lng, 'dated') })].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {g.dueOn && !['RESOLVED', 'WITHDRAWN'].includes(g.status) ? <span className={`text-caption ${g.dueOn < today ? 'font-semibold text-danger' : 'text-muted'}`}>{t('grievances.replyBy', { date: formatDate(g.dueOn, lng, 'dated') })}</span> : null}
                    <StatusPill tone={tone(g.status)}>{t(`grievances.status.${g.status}`)}</StatusPill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('grievances.file')}>
        <form onSubmit={(e) => void create(e)} className="grid gap-3">
          <Field label={t('grievances.titleLabel')}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={200} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('grievances.kind')}>{(p) => <Select {...p} name="kind" defaultValue="INDIVIDUAL">{(['INDIVIDUAL', 'GROUP', 'POLICY'] as const).map((k) => <option key={k} value={k}>{t(`grievances.kinds.${k}`)}</option>)}</Select>}</Field>
            <Field label={t('grievances.grievor')}>{(p) => <Select {...p} name="userId" defaultValue=""><option value="">{t('grievances.noGrievor')}</option>{(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field>
          </div>
          <Field label={t('grievances.articles')} hint={t('grievances.articlesHint')}>{(p) => <Input {...p} name="articles" maxLength={200} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('grievances.filedOn')}>{(p) => <Input {...p} name="filedOn" type="date" required defaultValue={today} />}</Field>
            <Field label={t('grievances.dueOn')} hint={t('grievances.dueHint')}>{(p) => <Input {...p} name="dueOn" type="date" />}</Field>
          </div>
          <div><Button type="submit" loading={busy === 'new'}>{t('grievances.file')}</Button></div>
        </form>
      </Dialog>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `#${open.number} · ${open.title}` : ''}>
        {open ? (
          <div className="grid gap-4 text-small">
            <ol className="grid gap-2 border-l-2 border-line pl-4">
              {open.history.map((h, i) => (
                <li key={i}>
                  <span className="font-semibold">{t(`grievances.status.${h.status}`)}</span> <span className="text-muted">· {formatDate(h.at.slice(0, 10), lng, 'dated')}</span>
                  {h.note ? <p className="text-muted">{h.note}</p> : null}
                </li>
              ))}
            </ol>
            {open.outcome ? <p><span className="font-semibold">{t('grievances.outcome')}:</span> {open.outcome}</p> : null}
            <form onSubmit={(e) => void update(e)} className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('grievances.step')}>{(p) => <Select {...p} name="status" defaultValue={open.status}>{GRIEVANCE_STATUSES.map((s) => <option key={s} value={s}>{t(`grievances.status.${s}`)}</option>)}</Select>}</Field>
                <Field label={t('grievances.dueOn')}>{(p) => <Input {...p} name="dueOn" type="date" defaultValue={open.dueOn ?? ''} />}</Field>
              </div>
              <Field label={t('grievances.note')}>{(p) => <Input {...p} name="note" maxLength={1000} />}</Field>
              <Field label={t('grievances.outcome')}>{(p) => <Textarea {...p} name="outcome" rows={3} maxLength={2000} defaultValue={open.outcome ?? ''} />}</Field>
              <div><Button type="submit" loading={busy === 'upd'}>{t('common.save')}</Button></div>
            </form>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}
