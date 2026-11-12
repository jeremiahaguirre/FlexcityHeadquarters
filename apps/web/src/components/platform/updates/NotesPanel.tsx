'use client';

import { Megaphone, Pencil, Plus, Send, Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { NoteBody } from '@/components/updates/NoteBody';
import { ApiError } from '@/lib/apiError';
import { papi, usePlatformQuery } from '@/lib/platform';
import { AudiencePicker, ROLES, type Ring, type Role, box, chip, fromLocalInput, toLocalInput, useAudienceText, whenText } from './shared';

type Status = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export interface ConsoleNote { id: string; titleEn: string; titleFr: string; bodyEn: string; bodyFr: string; roles: Role[]; tenantIds: string[]; ringIds: string[]; publishAt: string; publishedAt: string | null; withdrawnAt: string | null; status: Status }
const TONE: Record<Status, Tone> = { draft: 'neutral', scheduled: 'pending', published: 'ok', withdrawn: 'inactive' };
type Draft = Omit<ConsoleNote, 'id' | 'publishedAt' | 'withdrawnAt' | 'status'>;
const blank = (): Draft => ({ titleEn: '', titleFr: '', bodyEn: '', bodyFr: '', roles: [], tenantIds: [], ringIds: [], publishAt: new Date().toISOString() });

/** Dev console: write What's new notes in English and French, choose who sees them and when, publish. */
export function NotesPanel({ rings = [] }: { rings?: Ring[] }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const notes = usePlatformQuery<ConsoleNote[]>('/notes');
  const audience = useAudienceText();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const msg = e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error');
    setError(msg);
    toast(msg, 'warn');
  };
  async function save(publish: boolean) {
    if (!editing) return;
    setBusy(publish ? 'publish' : 'save');
    setError(null);
    try {
      const body = editing.draft;
      const saved = editing.id ? await papi<ConsoleNote>(`/notes/${editing.id}`, { method: 'PUT', body }) : await papi<ConsoleNote>('/notes', { method: 'POST', body });
      if (publish && !saved.publishedAt) await papi(`/notes/${saved.id}/publish`, { method: 'POST' });
      toast(publish ? t('updatesConsole.notePublished') : t('updatesConsole.noteSaved'), 'ok');
      setEditing(null);
      await notes.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  async function act(n: ConsoleNote, what: 'publish' | 'withdraw') {
    setBusy(`${what}:${n.id}`);
    try {
      await papi(`/notes/${n.id}/${what}`, { method: 'POST' });
      toast(what === 'publish' ? t('updatesConsole.notePublished') : t('updatesConsole.noteWithdrawn'), 'ok');
      await notes.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const lang = i18n.language;
  return (
    <section className="grid gap-4" aria-labelledby="notes-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="notes-h" className="text-heading">{t('updatesConsole.notesTitle')}</h2>
          <p className="mt-1 text-small text-muted">{t('updatesConsole.notesHelp')}</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => { setError(null); setEditing({ id: null, draft: blank() }); }}>{t('updatesConsole.newNote')}</Button>
      </div>
      {notes.error?.status === 403 ? (
        <Card><CardBody className="text-small text-muted">{t('updatesConsole.noAccess')}</CardBody></Card>
      ) : !notes.data ? (
        <Skeleton className="h-40" />
      ) : !notes.data.length ? (
        <EmptyState icon={Megaphone} title={t('updatesConsole.noNotes')}>{t('updatesConsole.noNotesHelp')}</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {notes.data.map((n) => (
            <article key={n.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-body-strong">{lang.startsWith('fr') ? n.titleFr : n.titleEn}</h3>
                  <StatusPill tone={TONE[n.status]}>{t(`updatesConsole.noteStatus.${n.status}`)}</StatusPill>
                </div>
                <p className="mt-0.5 text-small text-muted">
                  {whenText(n.publishAt, lang)} · {audience(n.tenantIds)} · {n.roles.length ? n.roles.map((r) => t(`roles.${r}`)).join(', ') : t('updatesConsole.everyone')}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {n.status !== 'withdrawn' ? (
                  <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => { setError(null); setEditing({ id: n.id, draft: { titleEn: n.titleEn, titleFr: n.titleFr, bodyEn: n.bodyEn, bodyFr: n.bodyFr, roles: n.roles, tenantIds: n.tenantIds, ringIds: n.ringIds, publishAt: n.publishAt } }); }}>{t('common.edit')}</Button>
                ) : null}
                {n.status === 'draft' ? (
                  <Button size="sm" loading={busy === `publish:${n.id}`} icon={<Send className="h-4 w-4" aria-hidden="true" />} onClick={() => void act(n, 'publish')}>{t('updatesConsole.publish')}</Button>
                ) : n.status !== 'withdrawn' ? (
                  <Button size="sm" variant="ghost" loading={busy === `withdraw:${n.id}`} icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void act(n, 'withdraw')}>{t('updatesConsole.withdraw')}</Button>
                ) : null}
              </div>
            </article>
          ))}
        </Card>
      )}

      <Dialog
        wide
        open={!!editing}
        onClose={() => setEditing(null)}
        closeLabel={t('common.close')}
        title={editing?.id ? t('updatesConsole.editNote') : t('updatesConsole.newNote')}
        description={t('updatesConsole.noteFormHelp')}
        footer={
          <>
            {error ? <p role="alert" className="mr-auto self-center text-small text-warn">{error}</p> : null}
            <Button variant="secondary" loading={busy === 'save'} onClick={() => void save(false)}>{t('updatesConsole.saveDraft')}</Button>
            {notes.data?.find((n) => n.id === editing?.id)?.publishedAt ? null : (
              <Button loading={busy === 'publish'} icon={<Send className="h-4 w-4" aria-hidden="true" />} onClick={() => void save(true)}>{t('updatesConsole.publish')}</Button>
            )}
          </>
        }
      >
        {d ? (
          <form className="grid gap-5" onSubmit={(e: FormEvent) => { e.preventDefault(); void save(false); }}>
            <div className="grid gap-4 md:grid-cols-2">
              {(['En', 'Fr'] as const).map((l) => (
                <div key={l} className="grid content-start gap-3">
                  <p className="text-label uppercase text-muted">{t(`updatesConsole.lang${l}`)}</p>
                  <Field label={t('updatesConsole.noteTitle')}>{(p) => <Input {...p} lang={l === 'Fr' ? 'fr' : 'en'} maxLength={120} required value={d[`title${l}`]} onChange={(e) => set({ [`title${l}`]: e.target.value } as Partial<Draft>)} />}</Field>
                  <Field label={t('updatesConsole.noteBody')} hint={t('updatesConsole.noteBodyHint')}>{(p) => <Textarea {...p} lang={l === 'Fr' ? 'fr' : 'en'} rows={6} maxLength={4000} required value={d[`body${l}`]} onChange={(e) => set({ [`body${l}`]: e.target.value } as Partial<Draft>)} />}</Field>
                  {d[`body${l}`].trim() ? (
                    <div className="rounded-xl border border-dashed border-line bg-surface/50 p-3" lang={l === 'Fr' ? 'fr' : 'en'}>
                      <p className="mb-1 text-caption text-muted">{t('updatesConsole.preview')}</p>
                      <p className="text-body-strong">{d[`title${l}`]}</p>
                      <NoteBody text={d[`body${l}`]} className="mt-1 grid gap-1.5 text-small" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-small font-semibold text-ink">{t('updatesConsole.roles')}</legend>
              <p className="-mt-1 text-small text-muted">{t('updatesConsole.rolesHelp')}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ROLES.map((r) => (
                  <label key={r} className={chip}>
                    <input type="checkbox" className={box} checked={d.roles.includes(r)} onChange={(e) => set({ roles: e.target.checked ? [...d.roles, r] : d.roles.filter((x) => x !== r) })} />
                    {t(`roles.${r}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <AudiencePicker tenantIds={d.tenantIds} ringIds={d.ringIds} rings={rings} onChange={(v) => set(v)} />
            <Field label={t('updatesConsole.publishAt')} hint={t('updatesConsole.publishAtHint')} className="max-w-xs">
              {(p) => <Input {...p} type="datetime-local" required value={toLocalInput(new Date(d.publishAt))} onChange={(e) => e.target.value && set({ publishAt: fromLocalInput(e.target.value) })} />}
            </Field>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
