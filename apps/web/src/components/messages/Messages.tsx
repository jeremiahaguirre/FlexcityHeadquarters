'use client';

import { ArrowLeft, BellOff, Bell, Building2, CalendarDays, Flag, LifeBuoy, Lock, MessageSquarePlus, MessagesSquare, MoreHorizontal, Paperclip, Pencil, Search, Send, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatClock, formatDate, formatInstant, formatSpan, formatTimeRange, localDateKey } from '@/lib/format';
import { type ConversationDetail, type ConversationSummary, type Directory, MAX_FILE_BYTES, MAX_TEXT, conversationTitle, readFile, seenBy, startsGroup } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { useLiveChange } from '@/lib/useLiveChange';
import { useAction, useQuery } from '@/lib/useQuery';

type Lng = 'en-CA' | 'fr-CA';
/** Today: the time; earlier: the day. */
const when = (iso: string, lng: Lng) => (new Date(iso).toDateString() === new Date().toDateString() ? formatClock(iso, lng) : formatInstant(iso, lng, 'short'));
const shiftWhen = (s: string, e: string, lng: Lng) => (localDateKey(s) === localDateKey(e) ? `${formatDate(s, lng)}, ${formatTimeRange(s, e, lng)}` : formatSpan(s, e, lng));
const KIND_ICON = { DIRECT: MessagesSquare, SHIFT: CalendarDays, DEPARTMENT: Building2, GROUP: Users } as const;

/** Messaging: the list of conversations and the open one. On a phone, one at a time. */
export function Messages() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const params = useSearchParams();
  const router = useRouter();
  const open = params.get('c');
  const list = useQuery<ConversationSummary[]>('/api/messages/conversations');
  useLiveChange('messages', () => void list.reload());
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const select = (id: string | null) => router.replace(id ? `/messages?c=${id}` : '/messages', { scroll: false });
  const shown = (list.data ?? []).filter((c) => !filter || conversationTitle(c, lng, '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="grid gap-4">
      <div className={cn('grid gap-4 md:grid-cols-[20rem_minmax(0,1fr)]', open ? '' : '')}>
        <section aria-label={t('messages.listLabel')} className={cn('grid content-start gap-3', open ? 'hidden md:grid' : '')}>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <Input aria-label={t('messages.find')} placeholder={t('messages.find')} value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" type="search" autoComplete="off" />
            </div>
            <Button icon={<MessageSquarePlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setCreating(true)}>{t('messages.new')}</Button>
          </div>
          {list.loading ? <ListSkeleton /> : !list.data?.length ? (
            <EmptyState icon={MessagesSquare} title={t('messages.emptyTitle')} action={<Button variant="secondary" onClick={() => setCreating(true)}>{t('messages.startOne')}</Button>}>{t('messages.emptyBody')}</EmptyState>
          ) : (
            <ul className="grid gap-1.5">
              {shown.map((c) => {
                const Icon = KIND_ICON[c.kind];
                const name = conversationTitle(c, lng, t('messages.someone'));
                const active = c.id === open;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => select(c.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn('flex min-h-[3.5rem] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors', active ? 'border-brand/40 bg-brand/10' : 'border-line bg-panel hover:bg-surface')}
                    >
                      {c.kind === 'DIRECT' ? <Avatar name={name} size="sm" /> : (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-brand-text"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-small', c.unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{name}</span>
                        <span className="block truncate text-caption text-muted">
                          {c.kind === 'SHIFT' && c.shift ? shiftWhen(c.shift.startsAt, c.shift.endsAt, lng) : t(`messages.kind.${c.kind}`, { count: c.memberCount })}
                          {c.lastMessageAt ? ` · ${when(c.lastMessageAt, lng)}` : ''}
                        </span>
                      </span>
                      {c.muted ? <BellOff className="h-4 w-4 shrink-0 text-muted" aria-label={t('messages.muted')} /> : null}
                      {c.readOnly ? <Lock className="h-4 w-4 shrink-0 text-muted" aria-label={t('messages.readOnlyShort')} /> : null}
                      {c.unread ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-caption font-bold text-brand-contrast">{c.unread > 99 ? '99+' : c.unread}<span className="sr-only"> {t('messages.unread')}</span></span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Notice />
        </section>
        <section aria-label={t('messages.threadLabel')} className={cn('min-w-0', open ? '' : 'hidden md:block')}>
          {open ? <Thread key={open} id={open} onBack={() => select(null)} onChanged={() => void list.reload()} /> : (
            <div className="hidden h-full min-h-[24rem] place-items-center rounded-xl2 border border-dashed border-line bg-panel p-8 text-center md:grid">
              <div className="grid max-w-xs justify-items-center gap-2">
                <MessagesSquare className="h-8 w-8 text-brand-text" aria-hidden="true" />
                <p className="text-body-strong">{t('messages.pickTitle')}</p>
                <p className="text-small text-muted">{t('messages.pickBody')}</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <NewConversation open={creating} onClose={() => setCreating(false)} onOpened={(id) => { setCreating(false); void list.reload(); select(id); }} />
    </div>
  );
}

/** What everyone should know: the employer can read workplace messages for an investigation; messages aren't for emergencies. */
function Notice() {
  const { t } = useTranslation();
  const { can } = useSession();
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface/60 p-3 text-caption text-muted">
      <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" /><span>{t('messages.employerAccess')}</span></p>
      <p className="flex gap-2">
        <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <span>
          {t('messages.notEmergency')}{' '}
          {can('lonework.self') ? <Link href="/alone" className="font-semibold text-brand-text underline underline-offset-2">{t('messages.helpButton')}</Link> : null}
        </span>
      </p>
    </div>
  );
}

function Thread({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const { me } = useSession();
  const toast = useToast();
  const q = useQuery<ConversationDetail>(`/api/messages/conversations/${id}`);
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const c = q.data;
  const lastId = c?.messages.at(-1)?.id;

  useLiveChange('messages', () => void q.reload());
  // Opening a conversation (and every new message while it's open) is a read receipt.
  useEffect(() => {
    if (!c || c.investigation || !lastId) return;
    void api(`/api/messages/conversations/${id}/read`, { method: 'POST' }).then(onChanged, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lastId, !!c]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  if (q.error) return <EmptyState icon={MessagesSquare} title={t('messages.goneTitle')} action={<Button variant="secondary" onClick={onBack}>{t('messages.back')}</Button>}>{t('messages.goneBody')}</EmptyState>;
  if (!c) return <ListSkeleton />;
  const name = conversationTitle(c, lng, t('messages.someone'));
  const readOnly = c.readOnly || c.investigation;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body && !file) return;
    if (file && file.size > MAX_FILE_BYTES) return toast(t('messages.fileTooBig'), 'warn');
    const attachment = file ? { fileName: file.name, data: await readFile(file) } : undefined;
    const r = editing
      ? await run('send', () => api(`/api/messages/${editing}`, { method: 'PATCH', body: { text: body } }))
      : await run('send', () => api(`/api/messages/conversations/${id}/messages`, { method: 'POST', body: { text: body, attachment } }));
    if (r !== undefined) {
      setText('');
      setFile(null);
      setEditing(null);
      if (fileRef.current) fileRef.current.value = '';
      await q.reload();
      onChanged();
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      void send();
    }
  };
  async function download(mid: string, fileName: string) {
    const r = await apiDownload(`/api/messages/${mid}/file`);
    if (r.ok) saveBlob(r.blob, fileName);
    else toast(t('common.error'), 'warn');
  }
  const lastMine = [...c.messages].reverse().find((m) => m.mine && !m.removed);

  return (
    <div className="flex h-[calc(100dvh-23rem)] min-h-[22rem] flex-col overflow-hidden rounded-xl2 border border-line bg-panel shadow-card md:h-[calc(100dvh-17rem)] md:min-h-[26rem]">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2 sm:px-4">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack} aria-label={t('messages.back')} icon={<ArrowLeft className="h-5 w-5" aria-hidden="true" />} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body-strong text-ink">{name}</h2>
          <p className="truncate text-caption text-muted">
            {c.kind === 'SHIFT' && c.shift ? shiftWhen(c.shift.startsAt, c.shift.endsAt, lng) : t(`messages.kind.${c.kind}`, { count: c.members.length })}
          </p>
        </div>
        {!c.investigation ? (
          <Button variant="ghost" size="sm" aria-pressed={c.muted} aria-label={c.muted ? t('messages.unmute') : t('messages.mute')} title={c.muted ? t('messages.unmute') : t('messages.mute')} icon={c.muted ? <BellOff className="h-5 w-5" aria-hidden="true" /> : <Bell className="h-5 w-5" aria-hidden="true" />} onClick={() => void run('mute', () => api(`/api/messages/conversations/${id}/mute`, { method: 'POST', body: { muted: !c.muted } }), c.muted ? t('messages.unmuted') : t('messages.mutedOk')).then(() => q.reload())} />
        ) : null}
        <Button variant="ghost" size="sm" aria-label={t('messages.members')} title={t('messages.members')} icon={<Users className="h-5 w-5" aria-hidden="true" />} onClick={() => setMembersOpen(true)} />
      </header>
      {c.investigation ? (
        <p role="status" className="flex gap-2 border-b border-line bg-warn-bg px-4 py-2 text-small text-ink"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />{t('messages.investigating', { reason: c.investigation.reason, until: formatInstant(c.investigation.expiresAt, lng) })}</p>
      ) : null}
      <div ref={scroller} className="fh-scroll-fade flex-1 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite" aria-relevant="additions">
        {c.more ? <p className="mb-3 text-center text-caption text-muted">{t('messages.older')}</p> : null}
        {!c.messages.length ? <p className="mt-10 text-center text-small text-muted">{t('messages.firstMessage')}</p> : null}
        <ol className="grid gap-1">
          {c.messages.map((m, i) => {
            const first = startsGroup(c.messages[i - 1], m);
            const seen = m.id === lastMine?.id ? seenBy(m, c.members) : [];
            return (
              <li key={m.id} className={cn('group flex flex-col', m.mine ? 'items-end' : 'items-start', first ? 'mt-3' : '')}>
                {first ? <p className="mb-1 px-1 text-caption text-muted">{m.mine ? t('messages.you') : m.author ?? t('messages.formerMember')} · {formatClock(m.createdAt, lng)}</p> : null}
                <div className="flex max-w-[min(85%,36rem)] items-end gap-1">
                  {m.mine && !readOnly && !m.removed ? <MessageMenu open={menu === m.id} onToggle={() => setMenu(menu === m.id ? null : m.id)} canEdit={m.canEdit} onEdit={() => { setEditing(m.id); setText(m.text ?? ''); setMenu(null); }} onRemove={() => { setMenu(null); void run('rm', () => api(`/api/messages/${m.id}`, { method: 'DELETE' }), t('messages.removedOk')).then(() => q.reload()); }} /> : null}
                  <div className={cn('min-w-0 rounded-2xl px-3.5 py-2 text-body', m.removed ? 'border border-dashed border-line bg-transparent italic text-muted' : m.mine ? 'bg-brand text-brand-contrast' : 'bg-surface text-ink')}>
                    {m.removed && !m.text ? t('messages.removed') : (
                      <>
                        {m.text ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : null}
                        {m.attachment ? (
                          <button type="button" onClick={() => void download(m.id, m.attachment!.fileName)} className={cn('mt-1 flex min-h-[2.75rem] items-center gap-2 rounded-lg px-2 text-small font-semibold underline-offset-2 hover:underline', m.mine ? 'bg-white/15' : 'bg-panel')}>
                            <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{m.attachment.fileName}</span>
                          </button>
                        ) : null}
                        {m.removed ? <p className="mt-1 text-caption not-italic">{t('messages.removedInvestigation')}</p> : null}
                        {m.original ? <p className="mt-1 text-caption">{t('messages.originalWas', { text: m.original })}</p> : null}
                      </>
                    )}
                  </div>
                  {!m.mine && !m.removed && !c.investigation ? (
                    <Button variant="ghost" size="sm" className="opacity-60 hover:opacity-100 focus-visible:opacity-100" aria-label={t('messages.report')} title={t('messages.report')} icon={<Flag className="h-4 w-4" aria-hidden="true" />} onClick={() => setReporting(m.id)} />
                  ) : null}
                </div>
                {m.editedAt && !m.removed ? <p className="px-1 text-caption text-muted">{t('messages.edited')}</p> : null}
                {seen.length ? <p className="px-1 text-caption text-muted">{c.kind === 'DIRECT' ? t('messages.seen') : t('messages.seenBy', { count: seen.length })}</p> : null}
              </li>
            );
          })}
        </ol>
      </div>
      {readOnly ? (
        <p className="flex gap-2 border-t border-line bg-surface/60 px-4 py-3 text-small text-muted"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{c.investigation ? t('messages.investigationReadOnly') : t(`messages.readOnly.${c.readOnly}`)}</p>
      ) : (
        <form onSubmit={(e) => void send(e)} className="grid gap-2 border-t border-line p-2 sm:p-3">
          {editing ? <p className="flex items-center justify-between gap-2 px-1 text-caption text-muted">{t('messages.editingHint')}<button type="button" className="font-semibold text-brand-text" onClick={() => { setEditing(null); setText(''); }}>{t('common.cancel')}</button></p> : null}
          {file ? (
            <p className="flex items-center gap-2 px-1 text-caption text-muted"><Paperclip className="h-4 w-4" aria-hidden="true" /><span className="truncate">{file.name}</span><button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface" aria-label={t('messages.removeFile')} onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}><X className="h-4 w-4" aria-hidden="true" /></button></p>
          ) : null}
          <div className="flex items-end gap-2">
            {!editing ? (
              <>
                <input ref={fileRef} id={`file-${id}`} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <label htmlFor={`file-${id}`} title={t('messages.attach')} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink">
                  <Paperclip className="h-5 w-5" aria-hidden="true" /><span className="sr-only">{t('messages.attach')}</span>
                </label>
              </>
            ) : null}
            <Textarea aria-label={t('messages.write')} placeholder={t('messages.write')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={Math.min(6, Math.max(1, text.split('\n').length))} maxLength={MAX_TEXT} style={{ minHeight: '2.75rem' }} className="max-h-40 flex-1 resize-none py-2.5" />
            <Button type="submit" aria-label={editing ? t('messages.saveEdit') : t('messages.send')} loading={busy === 'send'} disabled={!text.trim() && !file} icon={editing ? <Pencil className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} />
          </div>
          {text.length > MAX_TEXT - 200 ? <p className="px-1 text-caption text-muted">{t('messages.charsLeft', { count: MAX_TEXT - text.length })}</p> : null}
        </form>
      )}
      <MembersDialog open={membersOpen} onClose={() => setMembersOpen(false)} c={c} meId={me?.id ?? ''} reload={() => { void q.reload(); onChanged(); }} onLeft={onBack} />
      <ReportDialog messageId={reporting} onClose={() => setReporting(null)} />
    </div>
  );
}

function MessageMenu({ open, onToggle, canEdit, onEdit, onRemove }: { open: boolean; onToggle: () => void; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-label={t('messages.actions')} onClick={onToggle} className="grid h-9 w-9 place-items-center rounded-full text-muted opacity-60 hover:bg-surface hover:opacity-100 focus-visible:opacity-100">
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute bottom-10 right-0 z-10 grid min-w-[10rem] rounded-xl border border-line bg-panel p-1 shadow-card">
          {canEdit ? <button type="button" onClick={onEdit} className="flex min-h-[2.75rem] items-center gap-2 rounded-lg px-3 text-small hover:bg-surface"><Pencil className="h-4 w-4" aria-hidden="true" />{t('messages.edit')}</button> : null}
          <button type="button" onClick={onRemove} className="flex min-h-[2.75rem] items-center gap-2 rounded-lg px-3 text-small text-danger hover:bg-surface"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('messages.remove')}</button>
        </div>
      ) : null}
    </div>
  );
}

function ReportDialog({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get('reason'));
    const r = await run('report', () => api(`/api/messages/${messageId}/report`, { method: 'POST', body: { reason } }), t('messages.reported'));
    if (r !== undefined) onClose();
  }
  return (
    <Dialog open={!!messageId} onClose={onClose} title={t('messages.reportTitle')} description={t('messages.reportHelp')} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t('messages.reportReason')} hint={t('messages.reportHint')}>{(p) => <Textarea {...p} name="reason" required minLength={5} maxLength={1000} rows={4} />}</Field>
        <Button type="submit" variant="danger" className="justify-self-start" loading={busy === 'report'} icon={<Flag className="h-4 w-4" aria-hidden="true" />}>{t('messages.reportSend')}</Button>
      </form>
    </Dialog>
  );
}

function MembersDialog({ open, onClose, c, meId, reload, onLeft }: { open: boolean; onClose: () => void; c: ConversationDetail; meId: string; reload: () => void; onLeft: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const { run, busy } = useAction();
  const dir = useQuery<Directory>(open && c.kind === 'GROUP' && c.owner ? '/api/messages/people' : null);
  const [add, setAdd] = useState<string[]>([]);
  const canManage = c.kind === 'GROUP' && c.owner && !c.investigation;
  return (
    <Dialog open={open} onClose={onClose} title={t('messages.members')} description={c.kind === 'DIRECT' ? undefined : t(`messages.membersHelp.${c.kind}`)} closeLabel={t('common.close')}>
      <div className="grid gap-4">
        <ul className="divide-y divide-line">
          {c.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={m.name ?? '?'} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-semibold">{m.id === meId ? t('messages.youName', { name: m.name }) : m.name}{m.owner ? <span className="ml-2 text-caption font-normal text-muted">{t('messages.owner')}</span> : null}</p>
                <p className="text-caption text-muted">{!m.active ? t('messages.inactive') : m.lastReadAt ? t('messages.lastSeen', { when: formatInstant(m.lastReadAt, lng) }) : t('messages.notSeen')}</p>
              </div>
              {canManage && m.id !== meId ? <Button size="sm" variant="ghost" loading={busy === m.id} onClick={() => void run(m.id, () => api(`/api/messages/conversations/${c.id}/members/${m.id}`, { method: 'DELETE' }), t('messages.takenOut')).then(reload)}>{t('messages.takeOut')}</Button> : null}
            </li>
          ))}
        </ul>
        {canManage && dir.data ? (
          <div className="grid gap-2">
            <Field label={t('messages.addPeople')} hint={t('messages.ruleOfTwoHint')}>{(p) => <MultiSelect id={p.id} name="add" options={dir.data!.people.filter((x) => x.group && !c.members.some((m) => m.id === x.id)).map((x) => ({ value: x.id, label: x.name }))} onChange={setAdd} placeholder={t('messages.choosePeople')} />}</Field>
            <Button size="sm" variant="secondary" className="justify-self-start" disabled={!add.length} loading={busy === 'add'} icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => void run('add', () => api(`/api/messages/conversations/${c.id}/members`, { method: 'POST', body: { userIds: add } }), t('messages.added')).then((r) => { if (r !== undefined) { setAdd([]); reload(); } })}>{t('messages.add')}</Button>
          </div>
        ) : null}
        {c.kind === 'GROUP' && !c.investigation ? (
          <Button variant="ghost" className="justify-self-start text-danger" loading={busy === 'leave'} onClick={() => void run('leave', () => api(`/api/messages/conversations/${c.id}/members/me`, { method: 'DELETE' }), t('messages.left')).then((r) => { if (r !== undefined) { onClose(); onLeft(); reload(); } })}>{t('messages.leave')}</Button>
        ) : null}
      </div>
    </Dialog>
  );
}

type Mode = 'person' | 'group' | 'team';

/** Start a conversation: a person, a group (leads and HR), your department, or a shift you're on. */
function NewConversation({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const { can } = useSession();
  const dir = useQuery<Directory>(open ? '/api/messages/people' : null);
  const range = useMemo(() => ({ from: new Date(Date.now() - 12 * 3_600_000).toISOString(), to: new Date(Date.now() + 7 * 86_400_000).toISOString() }), [open]);
  const shifts = useQuery<Array<{ id: string; localStartsAt: string; localEndsAt: string; facility: { name: string } }>>(open && can('shifts.self') ? `/api/me/shifts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null);
  const { run, busy } = useAction();
  const [mode, setMode] = useState<Mode>('person');
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => { if (!open) { setQuery(''); setMembers([]); setMode('person'); } }, [open]);
  const people = (dir.data?.people ?? []).filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));
  const start = async (key: string, path: string, body: object) => {
    const r = await run(key, () => api<{ id: string }>(path, { method: 'POST', body }));
    if (r) onOpened(r.id);
  };
  async function group(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title'));
    await start('group', '/api/messages/groups', { title, memberIds: members });
  }
  const options: Array<{ value: Mode; label: string }> = [{ value: 'person', label: t('messages.modePerson') }, ...(dir.data?.canGroup ? [{ value: 'group' as const, label: t('messages.modeGroup') }] : []), { value: 'team', label: t('messages.modeTeam') }];
  return (
    <Dialog open={open} onClose={onClose} title={t('messages.new')} closeLabel={t('common.close')}>
      <div className="grid gap-4">
        <Segmented label={t('messages.new')} value={mode} onChange={setMode} options={options} />
        {mode === 'person' ? (
          <div className="grid gap-3">
            <Input aria-label={t('messages.findPerson')} placeholder={t('messages.findPerson')} value={query} onChange={(e) => setQuery(e.target.value)} type="search" autoComplete="off" />
            {dir.loading ? <ListSkeleton /> : !people.some((p) => p.direct) ? <p className="text-small text-muted">{t('messages.nobody')}</p> : (
              <ul className="grid max-h-[50dvh] gap-1 overflow-y-auto">
                {people.filter((p) => p.direct).map((p) => (
                  <li key={p.id}>
                    <button type="button" disabled={busy === p.id} onClick={() => void start(p.id, '/api/messages/direct', { userId: p.id })} className="flex min-h-[3rem] w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-surface">
                      <Avatar name={p.name} size="sm" /><span className="flex-1 truncate text-small font-semibold">{p.name}</span>{p.hr ? <StatusPill tone="neutral">{t('messages.hrBadge')}</StatusPill> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {dir.loading ? null : <p className="text-caption text-muted">{t('messages.someUnavailable')}</p>}
          </div>
        ) : mode === 'group' ? (
          <form onSubmit={(e) => void group(e)} className="grid gap-4">
            <Field label={t('messages.groupName')}>{(p) => <Input {...p} name="title" required minLength={2} maxLength={80} autoComplete="off" />}</Field>
            <Field label={t('messages.groupPeople')} hint={t('messages.ruleOfTwoHint')}>{(p) => <MultiSelect id={p.id} name="members" options={(dir.data?.people ?? []).filter((x) => x.group).map((x) => ({ value: x.id, label: x.name }))} onChange={setMembers} placeholder={t('messages.choosePeople')} />}</Field>
            <Button type="submit" className="justify-self-start" disabled={members.length < 2} loading={busy === 'group'} icon={<Users className="h-4 w-4" aria-hidden="true" />}>{t('messages.createGroup')}</Button>
          </form>
        ) : (
          <div className="grid gap-4">
            {dir.data?.departments.length ? (
              <div className="grid gap-1.5">
                <p className="text-small font-semibold">{t('messages.departments')}</p>
                {dir.data.departments.map((d) => (
                  <Button key={d.id} variant="secondary" className="justify-start" loading={busy === d.id} icon={<Building2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void start(d.id, '/api/messages/department', { departmentId: d.id })}>{(lng === 'fr-CA' && d.nameFr) || d.name}</Button>
                ))}
              </div>
            ) : null}
            {can('shifts.self') ? (
              <div className="grid gap-1.5">
                <p className="text-small font-semibold">{t('messages.myShifts')}</p>
                <p className="text-caption text-muted">{t('messages.shiftHelp')}</p>
                {!shifts.data?.length ? <p className="text-small text-muted">{t('messages.noShifts')}</p> : shifts.data.slice(0, 8).map((s) => (
                  <Button key={s.id} variant="secondary" className="h-auto min-h-[2.75rem] justify-start whitespace-normal py-2 text-left" loading={busy === s.id} icon={<CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={() => void start(s.id, '/api/messages/shift', { shiftId: s.id })}>
                    {s.facility.name} · {shiftWhen(s.localStartsAt, s.localEndsAt, lng)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}
