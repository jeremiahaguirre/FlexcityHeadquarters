'use client';

import { AlertTriangle, CheckCircle2, ClipboardPlus, FileCheck2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';
import { formatMoment } from '@/lib/format';

interface Claim { id: string; person: string; userId: string; facilityId: string; occurredAt: string; learnedAt: string; province: string; board: string; form: string; dueAt: string; lostTime: boolean; healthCare: boolean; description: string; status: 'OPEN' | 'FILED' | 'NOT_REQUIRED'; claimNumber: string | null; filedAt: string | null; verified: boolean }
const toLocal = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Workers' injuries, and the report to the compensation board before its deadline. */
export default function InjuriesPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery<{ claims: Claim[] }>('/api/injury-claims');
  const people = useQuery<Array<{ id: string; name: string }>>('/api/users');
  const facilities = useQuery<Array<{ id: string; name: string; province: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [filing, setFiling] = useState<Claim | null>(null);
  const when = (iso: string) => formatMoment(iso, i18n.language);
  const hoursLeft = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  const open = (q.data?.claims ?? []).filter((c) => c.status === 'OPEN');
  const rest = (q.data?.claims ?? []).filter((c) => c.status !== 'OPEN');

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = { userId: s('person'), facilityId: s('facility'), occurredAt: new Date(s('occurred')).toISOString(), learnedAt: new Date(s('learned')).toISOString(), lostTime: f.get('lost') === 'on', healthCare: f.get('care') === 'on', description: s('description') };
    if ((await run('add', () => api('/api/injury-claims', { method: 'POST', body }), t('injuries.added'))) !== undefined) {
      setAdding(false);
      await q.reload();
    }
  }
  async function file(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const claimNumber = String(new FormData(e.currentTarget).get('claim') || '') || null;
    if ((await run('file', () => api(`/api/injury-claims/${filing!.id}/filed`, { method: 'POST', body: { claimNumber } }), t('injuries.filed'))) !== undefined) {
      setFiling(null);
      await q.reload();
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('injuries.title')} description={t('injuries.description')} actions={<Button icon={<ClipboardPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('injuries.add')}</Button>} />
      <Card>
        <CardHeader title={t('injuries.toFile', { count: open.length })} />
        <CardBody className="pt-2">
          {!q.data ? <Skeleton className="h-24" /> : !open.length ? (
            <p className="flex items-center gap-2 text-small font-semibold text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{t('injuries.allFiled')}</p>
          ) : (
            <ul className="divide-y divide-line text-small">
              {open.map((c) => {
                const left = hoursLeft(c.dueAt);
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.person}</span><StatusPill tone={left < 0 ? 'danger' : left < 24 ? 'warn' : 'new'} icon={left < 24 ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : undefined}>{left < 0 ? t('injuries.overdue') : t('injuries.dueIn', { count: Math.max(1, left) })}</StatusPill></p>
                      <p className="text-caption text-muted">{c.description}</p>
                      <p className="text-caption text-muted">{t('injuries.toBoard', { board: c.board, form: c.form, due: when(c.dueAt) })}</p>
                    </div>
                    <Button size="sm" icon={<FileCheck2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setFiling(c)}>{t('injuries.markFiled')}</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
      {rest.length ? (
        <Card>
          <CardHeader title={t('injuries.history')} />
          <CardBody className="pt-1">
            <ul className="divide-y divide-line text-small">
              {rest.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><span className="font-semibold">{c.person}</span> · {when(c.occurredAt)}<span className="block text-caption text-muted">{c.description}</span></span>
                  <StatusPill tone={c.status === 'FILED' ? 'ok' : 'neutral'}>{c.status === 'FILED' ? t('injuries.filedWith', { board: c.board, number: c.claimNumber ?? '' }) : t('injuries.notRequired')}</StatusPill>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      {!q.data?.claims.length && q.data ? <EmptyState icon={ClipboardPlus} title={t('injuries.none')}>{t('injuries.noneHelp')}</EmptyState> : null}
      <p className="text-caption text-muted">{t('injuries.foot')}</p>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('injuries.add')} description={t('injuries.addHelp')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void add(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('injuries.person')}>{(p) => <Select {...p} name="person" required>{people.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field>
            <Field label={t('injuries.where')} hint={t('injuries.whereHint')}>{(p) => <Select {...p} name="facility" required>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.province})</option>)}</Select>}</Field>
            <Field label={t('injuries.occurred')}>{(p) => <Input {...p} name="occurred" type="datetime-local" required defaultValue={toLocal()} />}</Field>
            <Field label={t('injuries.learned')} hint={t('injuries.learnedHint')}>{(p) => <Input {...p} name="learned" type="datetime-local" required defaultValue={toLocal()} />}</Field>
          </div>
          <Field label={t('injuries.what')} hint={t('injuries.whatHint')}>{(p) => <Textarea {...p} name="description" required minLength={5} maxLength={300} rows={2} />}</Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-small font-semibold">{t('injuries.reportable')}</legend>
            <label className="flex items-start gap-2 text-small"><input type="checkbox" name="lost" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />{t('injuries.lostTime')}</label>
            <label className="flex items-start gap-2 text-small"><input type="checkbox" name="care" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />{t('injuries.healthCare')}</label>
            <p className="text-caption text-muted">{t('injuries.reportableHelp')}</p>
          </fieldset>
          <Button type="submit" loading={busy === 'add'} className="justify-self-start">{t('injuries.save')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!filing} onClose={() => setFiling(null)} title={t('injuries.markFiled')} description={filing ? t('injuries.toBoard', { board: filing.board, form: filing.form, due: when(filing.dueAt) }) : ''} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void file(e)}>
          <Field label={t('injuries.claimNumber')} hint={t('common.optional')}>{(p) => <Input {...p} name="claim" maxLength={40} />}</Field>
          <Button type="submit" loading={busy === 'file'} className="justify-self-start">{t('injuries.markFiled')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
