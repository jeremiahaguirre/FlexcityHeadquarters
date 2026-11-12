'use client';

import { Plus, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { papi, usePlatformQuery } from '@/lib/platform';
import { AudiencePicker, type Ring, fromLocalInput, toLocalInput, useAudienceText, whenText } from './shared';

type Status = 'upcoming' | 'active' | 'ended' | 'cancelled';
interface Win { id: string; startsAt: string; endsAt: string; messageEn: string; messageFr: string; tenantIds: string[]; ringIds: string[]; noticeSentAt: string | null; reminderSentAt: string | null; status: Status }
const TONE: Record<Status, Tone> = { upcoming: 'pending', active: 'warn', ended: 'inactive', cancelled: 'inactive' };
type Draft = { id: string | null; startsAt: string; endsAt: string; messageEn: string; messageFr: string; tenantIds: string[]; ringIds: string[] };

/** Dev console: schedule maintenance windows; HR admins are told, everyone sees a banner (services/platform/maintenance.ts). */
export function MaintenancePanel({ rings }: { rings: Ring[] }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const list = usePlatformQuery<Win[]>('/maintenance');
  const audience = useAudienceText();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lang = i18n.language;

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'ok');
      await list.reload();
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
      return false;
    } finally {
      setBusy(null);
    }
  }
  const fresh = (): Draft => {
    const s = new Date(Date.now() + 3 * 86_400_000);
    s.setHours(22, 0, 0, 0);
    return { id: null, startsAt: toLocalInput(s), endsAt: toLocalInput(new Date(s.getTime() + 3_600_000)), messageEn: '', messageFr: '', tenantIds: [], ringIds: [] };
  };
  return (
    <section className="grid gap-4" aria-labelledby="mw-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="mw-h" className="text-heading">{t('maintenance.consoleTitle')}</h2>
          <p className="mt-1 text-small text-muted">{t('maintenance.consoleHelp')}</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEdit(fresh())}>{t('maintenance.schedule')}</Button>
      </div>
      {!list.data ? (
        <Skeleton className="h-32" />
      ) : !list.data.length ? (
        <EmptyState icon={Wrench} title={t('maintenance.none')}>{t('maintenance.noneHelp')}</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {list.data.map((w) => (
            <article key={w.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-body-strong">{whenText(w.startsAt, lang)} – {whenText(w.endsAt, lang)}</h3>
                  <StatusPill tone={TONE[w.status]}>{t(`maintenance.status.${w.status}`)}</StatusPill>
                </div>
                <p className="mt-0.5 text-small text-muted">{lang.startsWith('fr') ? w.messageFr : w.messageEn}</p>
                <p className="mt-0.5 text-caption text-muted">{audience(w.tenantIds)}{w.noticeSentAt || w.reminderSentAt ? ` · ${t('maintenance.told')}` : ''}</p>
              </div>
              {w.status === 'upcoming' || w.status === 'active' ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ id: w.id, startsAt: toLocalInput(new Date(w.startsAt)), endsAt: toLocalInput(new Date(w.endsAt)), messageEn: w.messageEn, messageFr: w.messageFr, tenantIds: w.tenantIds, ringIds: w.ringIds })}>{t('common.edit')}</Button>
                  <Button size="sm" variant="ghost" loading={busy === `cancel:${w.id}`} icon={<XCircle className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(`cancel:${w.id}`, () => papi(`/maintenance/${w.id}/cancel`, { method: 'POST' }), t('maintenance.cancelled'))}>{t('maintenance.cancel')}</Button>
                </div>
              ) : null}
            </article>
          ))}
        </Card>
      )}
      <Dialog
        wide
        open={!!edit}
        onClose={() => setEdit(null)}
        closeLabel={t('common.close')}
        title={edit?.id ? t('maintenance.editTitle') : t('maintenance.schedule')}
        description={t('maintenance.formHelp')}
        footer={
          <Button
            loading={busy === 'save'}
            onClick={() =>
              edit &&
              void run('save', () => papi(edit.id ? `/maintenance/${edit.id}` : '/maintenance', { method: edit.id ? 'PUT' : 'POST', body: { startsAt: fromLocalInput(edit.startsAt), endsAt: fromLocalInput(edit.endsAt), messageEn: edit.messageEn, messageFr: edit.messageFr, tenantIds: edit.tenantIds, ringIds: edit.ringIds } }), t('maintenance.saved')).then((ok) => ok && setEdit(null))
            }
          >
            {t('common.save')}
          </Button>
        }
      >
        {edit ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('maintenance.starts')} hint={t('updatesConsole.publishAtHint')}>{(p) => <Input {...p} type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} />}</Field>
              <Field label={t('maintenance.ends')} hint={t('maintenance.endsHint')}>{(p) => <Input {...p} type="datetime-local" min={edit.startsAt} value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} />}</Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('maintenance.messageEn')} hint={t('maintenance.messageHint')}>{(p) => <Textarea {...p} lang="en" rows={3} maxLength={600} value={edit.messageEn} onChange={(e) => setEdit({ ...edit, messageEn: e.target.value })} />}</Field>
              <Field label={t('maintenance.messageFr')}>{(p) => <Textarea {...p} lang="fr" rows={3} maxLength={600} value={edit.messageFr} onChange={(e) => setEdit({ ...edit, messageFr: e.target.value })} />}</Field>
            </div>
            <AudiencePicker tenantIds={edit.tenantIds} ringIds={edit.ringIds} rings={rings} onChange={(v) => setEdit({ ...edit, ...v })} />
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
