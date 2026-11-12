'use client';

import { CalendarClock, Layers, Plus, Rocket, Undo2, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { type CitySummary, papi, usePlatformQuery } from '@/lib/platform';
import { type Ring, box, chip, fromLocalInput, toLocalInput, whenText } from './shared';

type StageStatus = 'SCHEDULED' | 'APPLIED' | 'ROLLED_BACK' | 'CANCELLED';
interface Stage { id: string; ringId: string; scheduledAt: string; noticeDays: number; status: StageStatus; organizations: number; applied: number; noticesSent: number; keptOwnChoice: number }
interface Release { id: string; name: string; summaryEn: string; summaryFr: string; features: Record<string, boolean>; createdAt: string; stages: Stage[] }
interface OrgPreview { tenantId: string; name: string; changes: Array<{ key: string; from: boolean; to: boolean }>; conflicts: Array<{ key: string; value: boolean }>; unchanged: string[] }
const TONE: Record<StageStatus, Tone> = { SCHEDULED: 'pending', APPLIED: 'ok', ROLLED_BACK: 'inactive', CANCELLED: 'inactive' };
const LIVE: StageStatus[] = ['SCHEDULED', 'APPLIED'];

/** Dev console: release rings, and feature releases that go out ring by ring (services/platform/releases.ts). */
export function ReleasesPanel({ rings, reloadRings, features }: { rings: Ring[] | null; reloadRings: () => Promise<void>; features: string[] }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const releases = usePlatformQuery<Release[]>('/releases');
  const cities = usePlatformQuery<CitySummary[]>('/tenants');
  const [ringEdit, setRingEdit] = useState<{ ring: Ring | null; name: string; tenantIds: string[] } | null>(null);
  const [relEdit, setRelEdit] = useState<{ id: string | null; name: string; summaryEn: string; summaryFr: string; features: Record<string, boolean> } | null>(null);
  const [schedule, setSchedule] = useState<{ release: Release; ring: Ring; at: string; noticeDays: number; preview: OrgPreview[] | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lang = i18n.language;
  const fname = (k: string) => t(`platform.features.${k}.name`, { defaultValue: k });
  const ringName = (id: string) => rings?.find((r) => r.id === id)?.name ?? '—';

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'ok');
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('common.error'), 'warn');
      return false;
    } finally {
      setBusy(null);
    }
  }
  /** The first ring this release hasn't reached yet. */
  const nextRing = (r: Release) => (rings ?? []).find((ring) => !r.stages.some((s) => s.ringId === ring.id && LIVE.includes(s.status)));
  async function openSchedule(release: Release, ring: Ring) {
    const last = release.stages.filter((s) => LIVE.includes(s.status)).map((s) => new Date(s.scheduledAt).getTime());
    const at = new Date(Math.max(Date.now() + 7 * 86_400_000, ...last.map((x) => x + 7 * 86_400_000)));
    at.setHours(6, 0, 0, 0);
    setSchedule({ release, ring, at: toLocalInput(at), noticeDays: 7, preview: null });
    const preview = await papi<OrgPreview[]>(`/releases/${release.id}/preview/${ring.id}`).catch(() => []);
    setSchedule((s) => (s && s.release.id === release.id ? { ...s, preview } : s));
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader
          title={t('releases.ringsTitle')}
          description={t('releases.ringsHelp')}
          action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRingEdit({ ring: null, name: '', tenantIds: [] })}>{t('releases.newRing')}</Button>}
        />
        <CardBody className="pt-0">
          {!rings ? (
            <Skeleton className="h-16" />
          ) : !rings.length ? (
            <p className="text-small text-muted">{t('releases.noRings')}</p>
          ) : (
            <ol className="grid gap-2 sm:grid-cols-3">
              {rings.map((r, i) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setRingEdit({ ring: r, name: r.name, tenantIds: r.tenantIds })} className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-line px-3 py-2.5 text-left hover:bg-surface">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-small font-bold text-brand-text">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-body-strong">{r.name}</span>
                      <span className="block text-caption text-muted">{t('updatesConsole.orgCount', { count: r.tenantIds.length })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <section className="grid gap-4" aria-labelledby="rel-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="rel-h" className="text-heading">{t('releases.title')}</h2>
            <p className="mt-1 text-small text-muted">{t('releases.help')}</p>
          </div>
          <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRelEdit({ id: null, name: '', summaryEn: '', summaryFr: '', features: {} })}>{t('releases.newRelease')}</Button>
        </div>
        {!releases.data ? (
          <Skeleton className="h-40" />
        ) : !releases.data.length ? (
          <EmptyState icon={Layers} title={t('releases.none')}>{t('releases.noneHelp')}</EmptyState>
        ) : (
          releases.data.map((r) => {
            const next = nextRing(r);
            const live = r.stages.some((s) => LIVE.includes(s.status));
            return (
              <Card key={r.id}>
                <CardBody className="grid gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-subheading">{r.name}</h3>
                      <p className="mt-0.5 text-small text-muted">{lang.startsWith('fr') ? r.summaryFr : r.summaryEn}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {!live ? <Button size="sm" variant="secondary" onClick={() => setRelEdit({ id: r.id, name: r.name, summaryEn: r.summaryEn, summaryFr: r.summaryFr, features: r.features })}>{t('common.edit')}</Button> : null}
                      {next ? <Button size="sm" icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />} onClick={() => void openSchedule(r, next)}>{t('releases.scheduleFor', { ring: next.name })}</Button> : null}
                      {live ? <Button size="sm" variant="ghost" loading={busy === `undo:${r.id}`} icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(`undo:${r.id}`, () => papi(`/releases/${r.id}/rollback`, { method: 'POST' }), t('releases.undone')).then(() => releases.reload())}>{t('releases.undoRelease')}</Button> : null}
                    </div>
                  </div>
                  <ul className="flex flex-wrap gap-1.5" aria-label={t('releases.switches')}>
                    {Object.entries(r.features).map(([k, on]) => (
                      <li key={k}><StatusPill tone={on ? 'ok' : 'neutral'}>{on ? t('releases.turnOn', { name: fname(k) }) : t('releases.turnOff', { name: fname(k) })}</StatusPill></li>
                    ))}
                  </ul>
                  {r.stages.length ? (
                    <ol className="grid gap-2 border-t border-line pt-3">
                      {r.stages.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="min-w-[6rem] text-body-strong">{ringName(s.ringId)}</span>
                          <StatusPill tone={TONE[s.status]}>{t(`releases.stageStatus.${s.status}`)}</StatusPill>
                          <span className="text-small text-muted">
                            {whenText(s.scheduledAt, lang)} · {t('releases.stageCounts', { applied: s.applied, count: s.organizations })}
                            {s.status === 'SCHEDULED' ? ` · ${t('releases.noticesSent', { sent: s.noticesSent, count: s.organizations })}` : ''}
                            {s.keptOwnChoice ? ` · ${t('releases.keptOwn', { count: s.keptOwnChoice })}` : ''}
                          </span>
                          <span className="ml-auto flex gap-1.5">
                            {s.status === 'SCHEDULED' ? <Button size="sm" variant="secondary" loading={busy === `apply:${s.id}`} icon={<Rocket className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(`apply:${s.id}`, () => papi(`/stages/${s.id}/apply`, { method: 'POST' }), t('releases.applied')).then(() => releases.reload())}>{t('releases.applyNow')}</Button> : null}
                            {LIVE.includes(s.status) ? <Button size="sm" variant="ghost" loading={busy === `back:${s.id}`} onClick={() => void run(`back:${s.id}`, () => papi(`/stages/${s.id}/rollback`, { method: 'POST' }), s.status === 'APPLIED' ? t('releases.undone') : t('releases.cancelled')).then(() => releases.reload())}>{s.status === 'APPLIED' ? t('releases.undo') : t('releases.cancel')}</Button> : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </CardBody>
              </Card>
            );
          })
        )}
      </section>

      {/* A ring: its name and its organizations. */}
      <Dialog
        open={!!ringEdit}
        onClose={() => setRingEdit(null)}
        closeLabel={t('common.close')}
        title={ringEdit?.ring ? ringEdit.ring.name : t('releases.newRing')}
        description={t('releases.ringFormHelp')}
        footer={
          <Button
            loading={busy === 'ring'}
            icon={<Users className="h-4 w-4" aria-hidden="true" />}
            onClick={() =>
              ringEdit &&
              void run(
                'ring',
                async () => {
                  const id = ringEdit.ring?.id ?? (await papi<{ id: string }>('/rings', { method: 'POST', body: { name: ringEdit.name } })).id;
                  await papi(`/rings/${id}/members`, { method: 'PUT', body: { tenantIds: ringEdit.tenantIds } });
                },
                t('releases.ringSaved'),
              ).then(async (ok) => {
                if (!ok) return;
                setRingEdit(null);
                await reloadRings();
              })
            }
          >
            {t('common.save')}
          </Button>
        }
      >
        {ringEdit ? (
          <div className="grid gap-4">
            {!ringEdit.ring ? <Field label={t('releases.ringName')}>{(p) => <Input {...p} maxLength={40} value={ringEdit.name} onChange={(e) => setRingEdit({ ...ringEdit, name: e.target.value })} placeholder={t('releases.ringNameExample')} />}</Field> : null}
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-small font-semibold">{t('updatesConsole.organizations')}</legend>
              {(cities.data ?? []).map((c) => {
                const elsewhere = rings?.find((r) => r.id !== ringEdit.ring?.id && r.tenantIds.includes(c.id));
                return (
                  <label key={c.id} className={chip}>
                    <input type="checkbox" className={box} checked={ringEdit.tenantIds.includes(c.id)} onChange={(e) => setRingEdit({ ...ringEdit, tenantIds: e.target.checked ? [...ringEdit.tenantIds, c.id] : ringEdit.tenantIds.filter((x) => x !== c.id) })} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {elsewhere ? <span className="text-caption text-muted">{t('releases.inRing', { ring: elsewhere.name })}</span> : null}
                  </label>
                );
              })}
            </fieldset>
          </div>
        ) : null}
      </Dialog>

      {/* A release: which switches, and the words HR admins get in advance. */}
      <Dialog
        wide
        open={!!relEdit}
        onClose={() => setRelEdit(null)}
        closeLabel={t('common.close')}
        title={relEdit?.id ? t('releases.editRelease') : t('releases.newRelease')}
        description={t('releases.releaseFormHelp')}
        footer={
          <Button
            loading={busy === 'release'}
            onClick={() =>
              relEdit &&
              void run('release', () => papi(relEdit.id ? `/releases/${relEdit.id}` : '/releases', { method: relEdit.id ? 'PUT' : 'POST', body: { name: relEdit.name, summaryEn: relEdit.summaryEn, summaryFr: relEdit.summaryFr, features: relEdit.features } }), t('releases.saved')).then(async (ok) => {
                if (!ok) return;
                setRelEdit(null);
                await releases.reload();
              })
            }
          >
            {t('common.save')}
          </Button>
        }
      >
        {relEdit ? (
          <div className="grid gap-4">
            <Field label={t('releases.name')}>{(p) => <Input {...p} maxLength={120} value={relEdit.name} onChange={(e) => setRelEdit({ ...relEdit, name: e.target.value })} />}</Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('releases.summaryEn')} hint={t('releases.summaryHint')}>{(p) => <Textarea {...p} lang="en" rows={3} maxLength={1000} value={relEdit.summaryEn} onChange={(e) => setRelEdit({ ...relEdit, summaryEn: e.target.value })} />}</Field>
              <Field label={t('releases.summaryFr')}>{(p) => <Textarea {...p} lang="fr" rows={3} maxLength={1000} value={relEdit.summaryFr} onChange={(e) => setRelEdit({ ...relEdit, summaryFr: e.target.value })} />}</Field>
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-small font-semibold">{t('releases.switches')}</legend>
              <div className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {features.map((k) => {
                  const v = relEdit.features[k];
                  const cycle = () => {
                    const f = { ...relEdit.features };
                    if (v === undefined) f[k] = true;
                    else if (v) f[k] = false;
                    else delete f[k];
                    setRelEdit({ ...relEdit, features: f });
                  };
                  return (
                    <button key={k} type="button" onClick={cycle} aria-pressed={v !== undefined} className={`${chip} justify-between text-left`}>
                      <span className="min-w-0 truncate">{fname(k)}</span>
                      <span className={`shrink-0 text-caption font-semibold ${v === undefined ? 'text-muted' : v ? 'text-ok' : 'text-warn'}`}>{v === undefined ? t('releases.unchanged') : v ? t('releases.on') : t('releases.off')}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-caption text-muted">{t('releases.switchesHint')}</p>
            </fieldset>
          </div>
        ) : null}
      </Dialog>

      {/* Scheduling a ring: when, how much notice, and the conflicts first. */}
      <Dialog
        wide
        open={!!schedule}
        onClose={() => setSchedule(null)}
        closeLabel={t('common.close')}
        title={schedule ? t('releases.scheduleTitle', { release: schedule.release.name, ring: schedule.ring.name }) : ''}
        description={t('releases.scheduleHelp')}
        footer={
          <Button
            loading={busy === 'schedule'}
            icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
            onClick={() =>
              schedule &&
              void run('schedule', () => papi(`/releases/${schedule.release.id}/stages`, { method: 'POST', body: { ringId: schedule.ring.id, scheduledAt: fromLocalInput(schedule.at), noticeDays: schedule.noticeDays } }), t('releases.scheduled')).then(async (ok) => {
                if (!ok) return;
                setSchedule(null);
                await releases.reload();
              })
            }
          >
            {t('releases.schedule')}
          </Button>
        }
      >
        {schedule ? (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('releases.when')} hint={t('updatesConsole.publishAtHint')}>{(p) => <Input {...p} type="datetime-local" value={schedule.at} onChange={(e) => setSchedule({ ...schedule, at: e.target.value })} />}</Field>
              <Field label={t('releases.noticeDays')} hint={t('releases.noticeDaysHint')}>{(p) => <Input {...p} type="number" min={0} max={60} value={schedule.noticeDays} onChange={(e) => setSchedule({ ...schedule, noticeDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />}</Field>
            </div>
            <div>
              <h3 className="mb-2 text-body-strong">{t('releases.previewTitle')}</h3>
              {!schedule.preview ? (
                <Skeleton className="h-20" />
              ) : !schedule.preview.length ? (
                <p className="text-small text-muted">{t('releases.ringEmpty')}</p>
              ) : (
                <ul className="grid gap-2">
                  {schedule.preview.map((o) => (
                    <li key={o.tenantId} className="rounded-xl border border-line p-3">
                      <p className="text-body-strong">{o.name}</p>
                      <p className="mt-0.5 text-small text-muted">
                        {o.changes.length ? o.changes.map((c) => (c.to ? t('releases.turnOn', { name: fname(c.key) }) : t('releases.turnOff', { name: fname(c.key) }))).join(' · ') : t('releases.nothingChanges')}
                      </p>
                      {o.conflicts.length ? (
                        <p className="mt-1.5 rounded-lg bg-warn/10 px-2.5 py-1.5 text-small text-ink">{t('releases.conflict', { names: o.conflicts.map((c) => fname(c.key)).join(', ') })}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
