'use client';

import { Flag, FolderSearch, MessageSquareWarning, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatInstant } from '@/lib/format';
import { type Directory, conversationTitle } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

type Lng = 'en-CA' | 'fr-CA';
interface Report { id: string; status: 'OPEN' | 'CLOSED'; reason: string; createdAt: string; closedAt: string | null; closingNote: string | null; reporter: string | null; author: string | null; conversationId: string; messageId: string; kind: string | null; open: boolean }
interface Settings { staffDirect: boolean; minorDirect: boolean; pushPreview: boolean; shiftArchiveHours: number; shiftArchiveLimits: [number, number] }

/** HR: reports of messages, opening a conversation for an investigation (audited, with a reason), and messaging settings. */
export function MessageReports() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const { can } = useSession();
  const reports = useQuery<Report[]>('/api/messages-admin/reports');
  const { run, busy } = useAction();
  const [investigate, setInvestigate] = useState<{ conversationId: string; reportId?: string } | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  async function close(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get('note'));
    const r = await run('close', () => api(`/api/messages-admin/reports/${closing}/close`, { method: 'POST', body: { note } }), t('messageReports.closed'));
    if (r !== undefined) { setClosing(null); await reports.reload(); }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <p className="flex gap-2 rounded-xl border border-line bg-surface/60 p-3 text-small text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" />{t('messageReports.auditNote')}</p>
      <section className="grid gap-3" aria-labelledby="reports-h">
        <h2 id="reports-h" className="text-subheading">{t('messageReports.reports')}</h2>
        {reports.loading ? <ListSkeleton /> : !reports.data?.length ? (
          <EmptyState icon={MessageSquareWarning} title={t('messageReports.noneTitle')}>{t('messageReports.noneBody')}</EmptyState>
        ) : (
          reports.data.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={t('messageReports.reportBy', { reporter: r.reporter ?? t('messages.formerMember'), author: r.author ?? t('messages.formerMember') })}
                description={`${formatInstant(r.createdAt, lng)} · ${r.kind ? t(`messageReports.kind.${r.kind}`) : ''}`}
                action={<StatusPill tone={r.status === 'OPEN' ? 'warn' : 'ok'}>{t(`messageReports.status.${r.status}`)}</StatusPill>}
              />
              <CardBody className="grid gap-3 pt-2">
                <p className="whitespace-pre-wrap text-body text-ink">{r.reason}</p>
                {r.closingNote ? <p className="text-small text-muted">{t('messageReports.closingNote', { note: r.closingNote })}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {r.open ? (
                    <Link href={`/messages?c=${r.conversationId}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-panel px-3 text-small font-semibold text-ink hover:bg-surface sm:h-9"><FolderSearch className="h-4 w-4" aria-hidden="true" />{t('messageReports.read')}</Link>
                  ) : (
                    <Button size="sm" variant="secondary" icon={<FolderSearch className="h-4 w-4" aria-hidden="true" />} onClick={() => setInvestigate({ conversationId: r.conversationId, reportId: r.id })}>{t('messageReports.openFor')}</Button>
                  )}
                  {r.status === 'OPEN' ? <Button size="sm" variant="ghost" onClick={() => setClosing(r.id)}>{t('messageReports.close')}</Button> : null}
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </section>
      <Lookup onInvestigate={(conversationId) => setInvestigate({ conversationId })} />
      {can('tenant.configure') ? <MessagingSettings /> : null}
      <InvestigateDialog target={investigate} onClose={() => setInvestigate(null)} onOpened={() => { setInvestigate(null); void reports.reload(); }} />
      <Dialog open={!!closing} onClose={() => setClosing(null)} title={t('messageReports.close')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void close(e)} className="grid gap-4">
          <Field label={t('messageReports.note')} hint={t('messageReports.noteHint')}>{(p) => <Textarea {...p} name="note" required minLength={3} maxLength={1000} rows={3} />}</Field>
          <Button type="submit" className="justify-self-start" loading={busy === 'close'}>{t('messageReports.close')}</Button>
        </form>
      </Dialog>
    </div>
  );
}

function InvestigateDialog({ target, onClose, onOpened }: { target: { conversationId: string; reportId?: string } | null; onClose: () => void; onOpened: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [opened, setOpened] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get('reason'));
    const r = await run('open', () => api(`/api/messages-admin/conversations/${target!.conversationId}/investigate`, { method: 'POST', body: { reason, reportId: target!.reportId } }), t('messageReports.openedOk'));
    if (r !== undefined) { setOpened(target!.conversationId); onOpened(); }
  }
  return (
    <>
      <Dialog open={!!target} onClose={onClose} title={t('messageReports.openFor')} description={t('messageReports.openHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <Field label={t('messageReports.reason')} hint={t('messageReports.reasonHint')}>{(p) => <Textarea {...p} name="reason" required minLength={10} maxLength={1000} rows={3} />}</Field>
          <Button type="submit" className="justify-self-start" loading={busy === 'open'} icon={<FolderSearch className="h-4 w-4" aria-hidden="true" />}>{t('messageReports.openConfirm')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!opened} onClose={() => setOpened(null)} title={t('messageReports.openedTitle')} closeLabel={t('common.close')}>
        <div className="grid gap-4">
          <p className="text-small text-muted">{t('messageReports.openedBody')}</p>
          <Link href={`/messages?c=${opened}`} className="justify-self-start font-semibold text-brand-text underline underline-offset-2">{t('messageReports.read')}</Link>
        </div>
      </Dialog>
    </>
  );
}

/** Find the conversations someone is in (names and members only), to open one for an investigation. */
function Lookup({ onInvestigate }: { onInvestigate: (conversationId: string) => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language as Lng;
  const dir = useQuery<Directory>('/api/messages/people');
  const [person, setPerson] = useState('');
  const convs = useQuery<Array<{ id: string; kind: string; title: string | null; titleFr?: string | null; members: Array<string | null>; messages: number; lastMessageAt: string | null }>>(person ? `/api/messages-admin/people/${person}/conversations` : null);
  return (
    <Card>
      <CardHeader title={t('messageReports.lookup')} description={t('messageReports.lookupHelp')} />
      <CardBody className="grid gap-3 pt-2">
        <Field label={t('messageReports.person')}>{(p) => (
          <Select {...p} value={person} onChange={(e) => setPerson(e.target.value)} className="max-w-sm">
            <option value="">{t('messageReports.choose')}</option>
            {(dir.data?.people ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}</Field>
        {person && convs.data ? (
          !convs.data.length ? <p className="text-small text-muted">{t('messageReports.noConversations')}</p> : (
            <ul className="divide-y divide-line">
              {convs.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-small font-semibold">{conversationTitle(c as never, lng, t(`messages.kind.${c.kind}`, { count: c.members.length }))}</p>
                    <p className="truncate text-caption text-muted">{t('messageReports.convLine', { count: c.messages, members: c.members.filter(Boolean).join(', ') })}</p>
                  </div>
                  <Button size="sm" variant="secondary" icon={<Flag className="h-4 w-4" aria-hidden="true" />} onClick={() => onInvestigate(c.id)}>{t('messageReports.openFor')}</Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}

function MessagingSettings() {
  const { t } = useTranslation();
  const q = useQuery<Settings>('/api/messages-admin/settings');
  const { run, busy } = useAction();
  if (!q.data) return null;
  const s = q.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { staffDirect: f.get('staffDirect') === 'on', minorDirect: f.get('minorDirect') === 'on', pushPreview: f.get('pushPreview') === 'on', shiftArchiveHours: Number(f.get('shiftArchiveHours')) };
    const r = await run('save', () => api('/api/messages-admin/settings', { method: 'PUT', body }), t('messageReports.saved'));
    if (r !== undefined) await q.reload();
  }
  const box = (name: 'staffDirect' | 'minorDirect' | 'pushPreview') => (
    <label className="flex items-start gap-3 text-small">
      <input type="checkbox" name={name} defaultChecked={s[name]} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
      <span><span className="font-semibold text-ink">{t(`messageReports.settings.${name}`)}</span><span className="block text-muted">{t(`messageReports.settings.${name}Help`)}</span></span>
    </label>
  );
  return (
    <Card>
      <CardHeader title={t('messageReports.settings.title')} description={t('messageReports.settings.help')} />
      <CardBody className="pt-2">
        <form key={JSON.stringify(s)} onSubmit={(e) => void save(e)} className="grid gap-4">
          {box('staffDirect')}
          {box('minorDirect')}
          {box('pushPreview')}
          <Field label={t('messageReports.settings.shiftArchiveHours')} hint={t('messageReports.settings.shiftArchiveHint', { min: s.shiftArchiveLimits[0], max: s.shiftArchiveLimits[1] })}>{(p) => <Input {...p} name="shiftArchiveHours" type="number" min={s.shiftArchiveLimits[0]} max={s.shiftArchiveLimits[1]} defaultValue={s.shiftArchiveHours} className="max-w-[8rem]" required />}</Field>
          <p className="text-caption text-muted">{t('messageReports.settings.ruleOfTwo')}</p>
          <Button type="submit" size="sm" className="justify-self-start" loading={busy === 'save'}>{t('common.save')}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
