'use client';

import { ClipboardPen, DoorOpen, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { OFFBOARD_REASONS, type Offboarding } from '@/lib/hr';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import { ManagerSelect } from '@/components/people/Reporting';

/** Leaving the city: a checklist per person, then benefits end and sign-in stops. */
export function OffboardingPanel() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ items: string[]; offboardings: Offboarding[] }>('/api/offboarding');
  const people = useQuery<Array<{ id: string; name: string; status: string }>>('/api/users');
  // Exit surveys: only with the surveys feature on (its permission goes with it) and for those who manage surveys.
  const { can } = useSession();
  const canSurvey = can('surveys.manage');
  const exits = useQuery<Array<{ id: string; hasSurvey: boolean }>>(canSurvey ? '/api/surveys-admin/offboardings' : null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<Offboarding | null>(null);
  const { run, busy } = useAction();

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('start', () => api(`/api/users/${f.get('userId')}/offboarding`, { method: 'POST', body: { lastDay: f.get('lastDay'), reason: f.get('reason') } }), t('offboarding.started'));
    if (r !== undefined) {
      setAdding(false);
      await data.reload();
    }
  }
  async function tick(o: Offboarding, key: string, done: boolean) {
    const r = await run(`${o.id}-${key}`, () => api(`/api/offboarding/${o.id}/items/${key}`, { method: 'PATCH', body: { done } }));
    if (r !== undefined) await data.reload();
  }
  async function complete(o: Offboarding, reassignTo?: string | null) {
    const r = await run('complete', () => api(`/api/offboarding/${o.id}/complete`, { method: 'POST', body: o.reports ? { reassignTo: reassignTo ?? null } : {} }), t('offboarding.completed', { name: o.name }));
    setConfirming(null);
    if (r !== undefined) await data.reload();
  }
  const busyIds = new Set((data.data?.offboardings ?? []).filter((o) => !o.completedAt).map((o) => o.userId));
  return (
    <Card>
      <CardHeader title={t('offboarding.title')} description={t('offboarding.help')} action={<Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('offboarding.start')}</Button>} />
      <CardBody className="grid gap-4 pt-2">
        {!data.data ? (
          <Skeleton className="h-40" />
        ) : !data.data.offboardings.length ? (
          <EmptyState icon={DoorOpen} title={t('offboarding.none')}>{t('offboarding.noneHelp')}</EmptyState>
        ) : (
          data.data.offboardings.map((o) => {
            const left = o.checklist.filter((i) => !i.done && i.key !== 'exitInterview').length;
            return (
              <section key={o.id} className="rounded-2xl border border-line p-4">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="block text-body-strong">{o.name}</span>
                    <span className="text-caption text-muted">{t('offboarding.line', { reason: t(`offboarding.reasons.${o.reason}`), date: formatDate(o.lastDay, lng, 'dated') })}</span>
                  </span>
                  {o.completedAt ? <StatusPill tone="ok">{t('offboarding.done')}</StatusPill> : <Button size="sm" disabled={left > 0} onClick={() => setConfirming(o)}>{left ? t('offboarding.left', { count: left }) : t('offboarding.finish')}</Button>}
                </header>
                {!o.completedAt ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {o.checklist.map((i) => (
                      <li key={i.key}>
                        <label className="flex items-start gap-2 text-small">
                          <input type="checkbox" checked={i.done} disabled={busy === `${o.id}-${i.key}`} onChange={(e) => void tick(o, i.key, e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
                          <span>{t(`offboarding.items.${i.key}`)}{i.key === 'exitInterview' ? <span className="text-muted"> ({t('offboarding.optional')})</span> : null}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!o.completedAt && canSurvey && exits.data ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    {exits.data.find((x) => x.id === o.id)?.hasSurvey ? (
                      <>
                        <StatusPill tone="ok">{t('offboarding.exitSurveyMade')}</StatusPill>
                        <ButtonLink href="/manage/surveys" size="sm" variant="ghost">{t('offboarding.seeSurveys')}</ButtonLink>
                      </>
                    ) : (
                      <ButtonLink href={`/manage/surveys?exit=${o.id}`} size="sm" variant="secondary" icon={<ClipboardPen className="h-4 w-4" aria-hidden="true" />}>{t('offboarding.sendExitSurvey')}</ButtonLink>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </CardBody>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('offboarding.start')}>
        <form onSubmit={(e) => void start(e)} className="grid gap-3">
          <Field label={t('offboarding.person')}>{(p) => <Select {...p} name="userId" required>{(people.data ?? []).filter((u) => u.status === 'ACTIVE' && !busyIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('offboarding.lastDay')}>{(p) => <Input {...p} name="lastDay" type="date" required />}</Field>
            <Field label={t('offboarding.reason')}>{(p) => <Select {...p} name="reason" required>{OFFBOARD_REASONS.map((r) => <option key={r} value={r}>{t(`offboarding.reasons.${r}`)}</option>)}</Select>}</Field>
          </div>
          <p className="text-caption text-muted">{t('offboarding.startHelp')}</p>
          <div><Button type="submit" loading={busy === 'start'}>{t('offboarding.start')}</Button></div>
        </form>
      </Dialog>
      <Dialog open={!!confirming} onClose={() => setConfirming(null)} title={t('offboarding.confirmTitle', { name: confirming?.name ?? '' })}>
        {confirming ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void complete(confirming, String(new FormData(e.currentTarget).get('reassignTo') ?? '') || null);
            }}
          >
            <p>{t('offboarding.confirmBody', { date: formatDate(confirming.lastDay, lng, 'dated') })}</p>
            {confirming.reports ? (
              <ManagerSelect name="reassignTo" exclude={[confirming.userId]} label={t('reporting.reassign', { count: confirming.reports, name: confirming.name })} hint={t('reporting.reassignHint')} />
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" variant="danger" loading={busy === 'complete'}>{t('offboarding.finish')}</Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </Card>
  );
}
