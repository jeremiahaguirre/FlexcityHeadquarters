'use client';

import { BellRing, Check, NotebookPen, Pin, Plus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { dateFormat, formatDate } from '@/lib/format';
import { useAction, useQuery } from '@/lib/useQuery';

const CATEGORIES = ['HANDOVER', 'MAINTENANCE', 'SAFETY', 'OTHER'] as const;
const CAT_TONE: Record<(typeof CATEGORIES)[number], Tone> = { HANDOVER: 'brand', MAINTENANCE: 'warn', SAFETY: 'danger', OTHER: 'neutral' };
interface Entry { id: string; category: (typeof CATEGORIES)[number]; body: string; createdAt: string; author: string }

/** A facility's shift log: newest first, add a note. */
export function Logbook() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const [facilityId, setFacilityId] = useState<string | null>(null);
  useEffect(() => {
    if (!facilityId && facilities.data?.length) setFacilityId(facilities.data[0]!.id);
  }, [facilities.data, facilityId]);
  const q = useQuery<Entry[]>(facilityId ? `/api/logbook?facilityId=${facilityId}` : null);
  const { run, busy } = useAction();
  const when = (iso: string) => dateFormat(lng, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await run('add', () => api('/api/logbook', { method: 'POST', body: { facilityId, category: String(f.get('category')), body: String(f.get('body')) } }), t('logbook.added'));
    if (r !== undefined) { form.reset(); await q.reload(); }
  }
  return (
    <div className="grid gap-6">
      {(facilities.data?.length ?? 0) > 1 ? (
        <Field label={t('logbook.facility')}>{(p) => <Select {...p} value={facilityId ?? ''} onChange={(e) => setFacilityId(e.target.value)} className="max-w-xs">{facilities.data!.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
      ) : null}
      <Card>
        <CardHeader title={t('logbook.add')} description={t('logbook.addHelp')} />
        <CardBody className="pt-4">
          <form onSubmit={(e) => void add(e)} className="grid gap-3">
            <Field label={t('logbook.category')}>{(p) => <Select {...p} name="category" defaultValue="HANDOVER" className="max-w-xs">{CATEGORIES.map((c) => <option key={c} value={c}>{t(`logbook.categories.${c}`)}</option>)}</Select>}</Field>
            <Field label={t('logbook.note')}>{(p) => <Textarea {...p} name="body" required minLength={3} maxLength={4000} rows={3} placeholder={t('logbook.placeholder')} />}</Field>
            <Button type="submit" className="justify-self-start" loading={busy === 'add'} icon={<NotebookPen className="h-4 w-4" aria-hidden="true" />}>{t('logbook.save')}</Button>
          </form>
        </CardBody>
      </Card>
      {q.loading ? <ListSkeleton /> : !q.data?.length ? (
        <EmptyState icon={NotebookPen} title={t('logbook.emptyTitle')}>{t('logbook.emptyBody')}</EmptyState>
      ) : (
        <ol className="fh-stagger grid gap-3">
          {q.data.map((e) => (
            <li key={e.id} className="rounded-2xl border border-line bg-panel p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-small text-muted"><StatusPill tone={CAT_TONE[e.category]}>{t(`logbook.categories.${e.category}`)}</StatusPill><span>{when(e.createdAt)} · {e.author}</span></div>
              <p className="whitespace-pre-wrap text-body text-ink">{e.body}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="text-caption text-muted">{t('logbook.foot')}</p>
    </div>
  );
}

interface Notice { id: string; title: string; body: string; pinned: boolean; publishedAt: string; read: boolean }

/** Today: unread and pinned announcements. */
export function MyAnnouncements() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Notice[]>('/api/me/announcements');
  const { run, busy } = useAction();
  const shown = (q.data ?? []).filter((n) => !n.read || n.pinned);
  if (!shown.length) return null;
  return (
    <section aria-label={t('announcements.title')} className="grid gap-3">
      {shown.map((n) => (
        <div key={n.id} className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
          <p className="flex items-center gap-2 text-body-strong text-ink">{n.pinned ? <Pin className="h-4 w-4 text-brand-text" aria-label={t('announcements.pinned')} /> : <BellRing className="h-4 w-4 text-brand-text" aria-hidden="true" />}{n.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-body text-ink">{n.body}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption text-muted">{formatDate(n.publishedAt, i18n.language)}</span>
            {!n.read ? <Button size="sm" variant="secondary" icon={<Check className="h-4 w-4" aria-hidden="true" />} loading={busy === n.id} onClick={() => void run(n.id, () => api(`/api/me/announcements/${n.id}/read`, { method: 'POST' })).then(() => q.reload())}>{t('announcements.gotIt')}</Button> : null}
          </div>
        </div>
      ))}
    </section>
  );
}

interface Row extends Notice { positionIds: string[]; facilityIds: string[]; expiresAt: string | null; read: never; of: number; reads?: number }

/** Supervisors and HR: post notices and see how many have read them. */
export function AnnouncementsAdmin() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<Array<Omit<Row, 'read'> & { read: number }>>('/api/announcements');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<string[]>([]);
  const [fac, setFac] = useState<string[]>([]);
  async function post(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const until = String(f.get('until') || '');
    const r = await run('post', () => api('/api/announcements', { method: 'POST', body: { title: String(f.get('title')), body: String(f.get('body')), positionIds: pos, facilityIds: fac, pinned: f.get('pinned') === 'on', expiresAt: until ? new Date(`${until}T23:59:00`).toISOString() : null } }), t('announcements.posted'));
    if (r !== undefined) { setOpen(false); setPos([]); setFac([]); await q.reload(); }
  }
  const now = Date.now();
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen(true)}>{t('announcements.new')}</Button>
      </div>
      {q.loading ? <ListSkeleton /> : !q.data?.length ? (
        <EmptyState icon={BellRing} title={t('announcements.noneTitle')}>{t('announcements.noneBody')}</EmptyState>
      ) : (
        q.data.map((n) => {
          const ended = !!n.expiresAt && new Date(n.expiresAt).getTime() <= now;
          return (
            <Card key={n.id}>
              <CardHeader title={n.title} description={`${formatDate(n.publishedAt, lng)} · ${n.positionIds.length || n.facilityIds.length ? t('announcements.some') : t('announcements.everyone')}`} action={ended ? <StatusPill tone="neutral">{t('announcements.ended')}</StatusPill> : <StatusPill tone={n.read >= n.of ? 'ok' : 'brand'}>{t('announcements.readCount', { read: n.read, of: n.of })}</StatusPill>} />
              <CardBody className="grid gap-2 pt-2">
                <p className="whitespace-pre-wrap text-body text-ink">{n.body}</p>
                {!ended ? <Button size="sm" variant="ghost" className="justify-self-start" loading={busy === n.id} onClick={() => void run(n.id, () => api(`/api/announcements/${n.id}/end`, { method: 'POST' }), t('announcements.endedOk')).then(() => q.reload())}>{t('announcements.end')}</Button> : null}
              </CardBody>
            </Card>
          );
        })
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('announcements.new')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void post(e)} className="grid gap-4">
          <Field label={t('announcements.titleField')}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={140} />}</Field>
          <Field label={t('announcements.body')}>{(p) => <Textarea {...p} name="body" required minLength={3} maxLength={4000} rows={5} />}</Field>
          <Field label={t('announcements.positions')}>{(p) => <MultiSelect id={p.id} name="positions" options={(positions.data ?? []).map((x) => ({ value: x.id, label: (lng === 'fr-CA' && x.nameFr) || x.name }))} onChange={setPos} placeholder={t('announcements.everyone')} />}</Field>
          <Field label={t('announcements.facilities')} hint={t('announcements.facilitiesHint')}>{(p) => <MultiSelect id={p.id} name="facilities" options={(facilities.data ?? []).map((x) => ({ value: x.id, label: x.name }))} onChange={setFac} placeholder={t('announcements.allFacilities')} />}</Field>
          <Field label={t('announcements.until')} hint={t('announcements.untilHint')}>{(p) => <Input {...p} name="until" type="date" className="max-w-xs" />}</Field>
          <label className="flex items-center gap-2 text-small font-semibold"><input type="checkbox" name="pinned" className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('announcements.pin')}</label>
          <Button type="submit" className="justify-self-start" loading={busy === 'post'}>{t('announcements.post')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
