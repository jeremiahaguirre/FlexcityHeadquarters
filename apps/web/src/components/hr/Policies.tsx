'use client';

import { ChevronRight, FileSignature, Plus, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface ToSign { id: string; title: string; body: string; version: number; publishedAt: string; dueOn: string | null }
interface Mine { toSign: ToSign[]; signed: Array<{ policyId: string; title: string; version: number; signedAt: string; signedName: string }> }

/** Reminder on Today when something is waiting. */
export function PoliciesBanner() {
  const { t } = useTranslation();
  const q = useQuery<Mine>('/api/me/policies');
  const n = q.data?.toSign.length ?? 0;
  if (!n) return null;
  return (
    <Link href="/profile#policies" className="flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-body text-ink hover:bg-warn/15">
      <FileSignature className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-semibold">{t('policies.banner', { count: n })}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
    </Link>
  );
}

/** The person's policies: read and sign, and what they've signed. */
export function MyPolicies() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const q = useQuery<Mine>('/api/me/policies');
  const { run, busy } = useAction();
  const [reading, setReading] = useState<ToSign | null>(null);
  if (!q.data || (!q.data.toSign.length && !q.data.signed.length)) return null;
  async function sign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const signedName = String(new FormData(e.currentTarget).get('name'));
    const r = await run('sign', () => api(`/api/me/policies/${reading!.id}/sign`, { method: 'POST', body: { signedName } }), t('policies.signedOk'));
    if (r !== undefined) { setReading(null); await q.reload(); }
  }
  return (
    <Card id="policies">
      <CardHeader title={t('policies.title')} description={t('policies.help')} />
      <CardBody className="grid gap-3 pt-2">
        {q.data.toSign.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/40 p-3">
            <span className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="font-semibold text-ink">{p.title}</span>{p.version > 1 ? <span className="text-muted"> · {t('policies.version', { n: p.version })}</span> : null}{p.dueOn ? <span className="block text-caption text-muted">{t('policies.dueBy', { date: formatDate(p.dueOn, i18n.language) })}</span> : null}</span>
            <Button size="sm" icon={<FileSignature className="h-4 w-4" aria-hidden="true" />} onClick={() => setReading(p)}>{t('policies.readSign')}</Button>
          </div>
        ))}
        {q.data.signed.length ? (
          <ul className="grid gap-1 text-small">
            {q.data.signed.map((s) => (
              <li key={s.policyId} className="flex justify-between gap-3 border-b border-line py-1.5 last:border-0"><span className="text-ink">{s.title}{s.version > 1 ? ` (${t('policies.version', { n: s.version })})` : ''}</span><span className="text-muted">{t('policies.signedOn', { date: formatDate(s.signedAt, i18n.language) })}</span></li>
            ))}
          </ul>
        ) : null}
      </CardBody>
      <Dialog open={!!reading} onClose={() => setReading(null)} title={reading?.title ?? ''} closeLabel={t('common.close')}>
        {reading ? (
          <form onSubmit={(e) => void sign(e)} className="grid gap-4">
            <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-body text-ink">{reading.body}</div>
            <Field label={t('policies.typeName')} hint={t('policies.typeNameHint')}>{(f) => <Input {...f} name="name" required minLength={2} maxLength={120} defaultValue={me ? `${me.firstName} ${me.lastName}` : ''} autoComplete="name" />}</Field>
            <Button type="submit" className="justify-self-start" loading={busy === 'sign'} icon={<FileSignature className="h-4 w-4" aria-hidden="true" />}>{t('policies.sign')}</Button>
          </form>
        ) : null}
      </Dialog>
    </Card>
  );
}

interface Row { id: string; title: string; body: string; version: number; positionIds: string[]; dueDays: number | null; publishedAt: string; signed: number; of: number }
interface Status { signed: Array<{ userId: string; name: string; signedAt: string }>; waiting: Array<{ userId: string; name: string; dueOn: string | null; overdue: boolean }> }

/** HR: publish, revise and retire policies; see who has signed. */
export function PoliciesPanel() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<Row[]>('/api/policies');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Row | null>(null);
  const status = useQuery<Status>(viewing ? `/api/policies/${viewing.id}/status` : null);
  const open = (r: Row | 'new') => { setPositionIds(r === 'new' ? [] : r.positionIds); setEditing(r); };
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { title: String(f.get('title')), body: String(f.get('body')), positionIds, dueDays: f.get('due') ? Number(f.get('due')) : null };
    const path = editing === 'new' ? '/api/policies' : `/api/policies/${(editing as Row).id}/revise`;
    const r = await run('save', () => api(path, { method: 'POST', body }), editing === 'new' ? t('policies.published') : t('policies.revised'));
    if (r !== undefined) { setEditing(null); await q.reload(); }
  }
  const options = (positions.data ?? []).map((p) => ({ value: p.id, label: (lng === 'fr-CA' && p.nameFr) || p.name }));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-small text-muted">{t('policies.hrHelp')}</p>
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => open('new')}>{t('policies.new')}</Button>
      </div>
      {q.loading ? <Skeleton className="h-40" /> : !q.data?.length ? (
        <EmptyState icon={ScrollText} title={t('policies.noneTitle')}>{t('policies.noneBody')}</EmptyState>
      ) : (
        q.data.map((p) => (
          <Card key={p.id}>
            <CardHeader title={p.title} description={`${t('policies.version', { n: p.version })} · ${formatDate(p.publishedAt, lng)} · ${p.positionIds.length ? t('policies.forPositions', { count: p.positionIds.length }) : t('policies.forEveryone')}`} action={<StatusPill tone={p.signed >= p.of ? 'ok' : 'warn'}>{t('policies.progress', { signed: p.signed, of: p.of })}</StatusPill>} />
            <CardBody className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="secondary" onClick={() => setViewing(p)}>{t('policies.whoSigned')}</Button>
              <Button size="sm" variant="ghost" onClick={() => open(p)}>{t('policies.revise')}</Button>
              <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => void run(p.id, () => api(`/api/policies/${p.id}/retire`, { method: 'POST' }), t('policies.retired')).then(() => q.reload())}>{t('policies.retire')}</Button>
            </CardBody>
          </Card>
        ))
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('policies.new') : t('policies.reviseTitle')} description={editing !== 'new' ? t('policies.reviseHelp') : undefined} closeLabel={t('common.close')}>
        {editing ? (
          <form onSubmit={(e) => void save(e)} className="grid gap-4">
            <Field label={t('policies.titleField')}>{(f) => <Input {...f} name="title" required minLength={3} maxLength={140} defaultValue={editing === 'new' ? '' : editing.title} />}</Field>
            <Field label={t('policies.text')} hint={t('policies.textHint')}>{(f) => <Textarea {...f} name="body" required minLength={20} maxLength={60000} rows={10} defaultValue={editing === 'new' ? '' : editing.body} />}</Field>
            <Field label={t('policies.who')}>{(f) => <MultiSelect id={f.id} name="positions" options={options} defaultValue={positionIds} onChange={setPositionIds} placeholder={t('policies.everyone')} />}</Field>
            <Field label={t('policies.dueDays')} hint={t('policies.dueDaysHint')}>{(f) => <Input {...f} name="due" type="number" min={1} max={365} defaultValue={editing === 'new' ? 14 : (editing.dueDays ?? '')} className="w-32" />}</Field>
            <Button type="submit" className="justify-self-start" loading={busy === 'save'}>{editing === 'new' ? t('policies.publish') : t('policies.publishRevision')}</Button>
          </form>
        ) : null}
      </Dialog>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title ?? ''} closeLabel={t('common.close')}>
        {status.data ? (
          <div className="grid gap-4 text-small">
            <section><h3 className="mb-1 text-label uppercase text-muted">{t('policies.waiting', { count: status.data.waiting.length })}</h3>
              <ul className="grid gap-1">{status.data.waiting.map((w) => <li key={w.userId} className="flex justify-between gap-2"><span>{w.name}</span>{w.overdue ? <StatusPill tone="danger">{t('policies.overdue')}</StatusPill> : w.dueOn ? <span className="text-muted">{t('policies.dueBy', { date: formatDate(w.dueOn, lng) })}</span> : null}</li>)}</ul></section>
            <section><h3 className="mb-1 text-label uppercase text-muted">{t('policies.signedCount', { count: status.data.signed.length })}</h3>
              <ul className="grid gap-1">{status.data.signed.map((s) => <li key={s.userId} className="flex justify-between gap-2"><span>{s.name}</span><span className="text-muted">{formatDate(s.signedAt, lng)}</span></li>)}</ul></section>
          </div>
        ) : <Skeleton className="h-32" />}
      </Dialog>
    </div>
  );
}
