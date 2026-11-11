'use client';

import { ArrowLeft, Lock, MessagesSquare, Plus, Send, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { useAction, useQuery } from '@/lib/useQuery';

interface Local { id: string; name: string; isSteward: boolean }
interface Thread { id: string; title: string; createdAt: string; messages: number; lastMessageAt: string | null }
interface Message { id: string; authorUserId: string; authorName: string | null; createdAt: string; body: string }
interface RosterRow { id: string; first_name: string; last_name: string; employment_status: string; seniority_date: string | null; seniority_hours: string }
interface Person { id: string; name: string; member: boolean; isSteward: boolean }

type Tab = 'threads' | 'seniority' | 'members';

/** Browser-local date/time for union timestamps (they aren't tied to a facility). */
const local = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

export default function UnionPage() {
  const { t } = useTranslation();
  const locals = useQuery<Local[]>('/api/union/locals');
  const [chosen, setChosen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('threads');
  const current = locals.data?.find((l) => l.id === chosen) ?? locals.data?.[0];

  return (
    <>
      <PageHeader title={t('union.title')} description={current?.name ?? t('union.description')} />
      <p className="mb-6 flex max-w-prose items-start gap-2 rounded-xl bg-surface px-4 py-3 text-small text-muted">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('union.privacy')}
      </p>
      {locals.error ? (
        <ErrorNotice onRetry={locals.reload} />
      ) : !locals.data ? (
        <ListSkeleton rows={3} />
      ) : !current ? (
        <EmptyState icon={MessagesSquare} title={t('union.noLocal')}>{t('union.noLocalHelp')}</EmptyState>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {locals.data.length > 1 ? (
              <div className="w-64">
                <Select aria-label={t('union.local')} value={current.id} onChange={(e) => setChosen(e.target.value)}>
                  {locals.data.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <Segmented
              label={t('union.section')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'threads' as const, label: t('union.tabs.threads') },
                { value: 'seniority' as const, label: t('union.tabs.seniority') },
                ...(current.isSteward ? [{ value: 'members' as const, label: t('union.tabs.members') }] : []),
              ]}
            />
          </div>
          {tab === 'threads' ? <Threads key={current.id} local={current} /> : null}
          {tab === 'seniority' ? <Seniority key={current.id} local={current} /> : null}
          {tab === 'members' && current.isSteward ? <Members key={current.id} local={current} /> : null}
        </>
      )}
    </>
  );
}

function Threads({ local: l }: { local: Local }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const threads = useQuery<Thread[]>(`/api/union/locals/${l.id}/threads`);
  const [open, setOpen] = useState<Thread | null>(null);
  const [starting, setStarting] = useState(false);
  const { run, busy } = useAction();

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('start', () => api<{ id: string }>(`/api/union/locals/${l.id}/threads`, { method: 'POST', body: { title: f.get('title'), body: f.get('body') } }), t('union.started'));
    if (r) {
      setStarting(false);
      await threads.reload();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className={cn('grid content-start gap-3', open && 'hidden lg:grid')}>
        <Button icon={<Plus className="h-5 w-5" aria-hidden="true" />} onClick={() => setStarting(true)} className="justify-self-start">
          {t('union.newThread')}
        </Button>
        {threads.loading ? (
          <ListSkeleton rows={3} />
        ) : !threads.data?.length ? (
          <EmptyState icon={MessagesSquare} title={t('union.noThreads')}>{t('union.noThreadsHelp')}</EmptyState>
        ) : (
          <Card className="divide-y divide-line">
            {threads.data.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => setOpen(th)}
                aria-current={open?.id === th.id}
                className={cn('grid w-full gap-0.5 px-4 py-3 text-left hover:bg-surface/60', open?.id === th.id && 'bg-surface')}
              >
                <span className="text-body-strong">{th.title}</span>
                <span className="text-small text-muted">
                  {t('union.messages', { count: th.messages })} · {formatDate(local(th.lastMessageAt ?? th.createdAt), lng, 'dated')}
                </span>
              </button>
            ))}
          </Card>
        )}
      </div>
      {open ? (
        <ThreadView local={l} thread={open} onBack={() => setOpen(null)} onPosted={threads.reload} />
      ) : (
        <div className="hidden lg:block">
          <EmptyState icon={MessagesSquare} title={t('union.pickThread')} />
        </div>
      )}

      <Dialog open={starting} onClose={() => setStarting(false)} title={t('union.newThread')} description={t('union.newThreadHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void start(e)} className="grid gap-4">
          <Field label={t('union.subject')}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={140} />}</Field>
          <Field label={t('union.firstMessage')}>{(p) => <Textarea {...p} name="body" required maxLength={8000} className="min-h-[8rem]" />}</Field>
          <Button type="submit" loading={busy === 'start'}>
            {t('union.post')}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function ThreadView({ local: l, thread, onBack, onPosted }: { local: Local; thread: Thread; onBack: () => void; onPosted: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { me } = useSession();
  const messages = useQuery<Message[]>(`/api/union/locals/${l.id}/threads/${thread.id}`);
  const [draft, setDraft] = useState('');
  const { run, busy } = useAction();

  async function reply(e: FormEvent) {
    e.preventDefault();
    const r = await run('reply', () => api(`/api/union/locals/${l.id}/threads/${thread.id}/messages`, { method: 'POST', body: { body: draft } }));
    if (r) {
      setDraft('');
      await Promise.all([messages.reload(), onPosted()]);
    }
  }

  return (
    <Card>
      <CardBody className="grid gap-5">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onBack} aria-label={t('union.back')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface lg:hidden">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h2 className="pt-1.5 text-heading">{thread.title}</h2>
        </div>
        {messages.loading ? (
          <ListSkeleton rows={2} />
        ) : (
          <ol className="grid gap-4">
            {messages.data?.map((m) => {
              const mine = m.authorUserId === me?.id;
              const name = m.authorName ?? t('union.formerMember');
              return (
                <li key={m.id} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
                  <Avatar name={name} size="sm" />
                  <div className={cn('max-w-[36rem] rounded-2xl px-4 py-3', mine ? 'bg-brand text-brand-contrast' : 'bg-surface')}>
                    <p className={cn('mb-1 text-caption', mine ? 'text-brand-contrast/80' : 'text-muted')}>
                      <span className={cn('font-semibold', mine ? 'text-brand-contrast' : 'text-ink')}>{mine ? t('union.you') : name}</span> · {formatDate(local(m.createdAt), lng)} {formatTime(local(m.createdAt), lng)}
                    </p>
                    <p className="whitespace-pre-wrap text-body">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <form onSubmit={(e) => void reply(e)} className="grid gap-2 border-t border-line pt-4">
          <label htmlFor="reply" className="sr-only">
            {t('union.reply')}
          </label>
          <Textarea id="reply" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('union.replyPlaceholder')} maxLength={8000} className="min-h-[5rem]" />
          <Button type="submit" className="justify-self-end" disabled={!draft.trim()} loading={busy === 'reply'} icon={<Send className="h-4 w-4" aria-hidden="true" />}>
            {t('union.send')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Seniority({ local: l }: { local: Local }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const roster = useQuery<RosterRow[]>(`/api/union/locals/${l.id}/seniority`);
  if (roster.loading) return <ListSkeleton rows={4} />;
  return (
    <Card>
      <CardBody>
        <p className="mb-4 text-small text-muted">{t('union.seniorityHelp')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-small">
            <thead className="text-caption font-semibold text-muted">
              <tr>
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">{t('union.name')}</th>
                <th className="py-2 pr-3">{t('staff.employmentLabel')}</th>
                <th className="py-2 pr-3">{t('staff.seniorityDate')}</th>
                <th className="py-2 text-right">{t('union.hours')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roster.data?.map((r, i) => (
                <tr key={r.id}>
                  <td className="py-2.5 pr-3 tabular-nums text-muted">{i + 1}</td>
                  <td className="py-2.5 pr-3 font-semibold">
                    {r.first_name} {r.last_name}
                  </td>
                  <td className="py-2.5 pr-3">{t(`staff.employment.${r.employment_status}`)}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{r.seniority_date ? formatDate(`${r.seniority_date.slice(0, 10)}T12:00:00`, lng, 'dated') : '—'}</td>
                  <td className="py-2.5 text-right tabular-nums">{new Intl.NumberFormat(lng, { minimumFractionDigits: 2 }).format(Number(r.seniority_hours))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function Members({ local: l }: { local: Local }) {
  const { t } = useTranslation();
  const people = useQuery<Person[]>(`/api/union/locals/${l.id}/directory`);
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const set = async (p: Person, isSteward: boolean, msg: string) => {
    await run(p.id, () => api(`/api/union/locals/${l.id}/members`, { method: 'POST', body: { userId: p.id, isSteward } }), msg);
    await people.reload();
  };
  const shown = people.data?.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) ?? [];
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="max-w-sm">
        <Input aria-label={t('union.search')} placeholder={t('union.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {people.loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <Card className="divide-y divide-line">
          {shown.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={p.name} size="sm" />
              <span className="min-w-0 flex-1 text-body-strong">{p.name}</span>
              {p.isSteward ? <StatusPill tone="brand">{t('roles.UNION_STEWARD')}</StatusPill> : p.member ? <StatusPill tone="ok">{t('union.member')}</StatusPill> : null}
              {!p.member ? (
                <Button size="sm" variant="secondary" loading={busy === p.id} icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => void set(p, false, t('union.added', { name: p.name }))}>
                  {t('union.add')}
                </Button>
              ) : !p.isSteward ? (
                <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => void set(p, true, t('union.madeSteward', { name: p.name }))}>
                  {t('union.makeSteward')}
                </Button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
