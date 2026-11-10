'use client';

import { Download, Plus, Snowflake } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import type { Patrol, RouteStatus, WinterSettings } from '@/lib/winter';
import { dateFormat } from '@/lib/format';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

/** Winter operations: switch call-outs and patrol records on or off, set the city's own time frames, routes and records. */
export default function WinterPage() {
  const { t, i18n } = useTranslation();
  const { can, reload: reloadMe } = useSession();
  const toast = useToast();
  const settings = useQuery<WinterSettings>('/api/winter/settings');
  const routes = useQuery<RouteStatus[]>('/api/winter/routes');
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) }));
  const records = useQuery<Patrol[]>(can('winter.records') && settings.data?.patrolsOn ? `/api/patrols?from=${range.from}&to=${range.to}` : null);
  const { run, busy } = useAction();
  const manage = can('winter.manage');
  const month = (m: string) => dateFormat(i18n.language, { month: 'long', timeZone: 'UTC' }).format(new Date(`2026-${m}-15T12:00:00Z`));
  const when = (iso: string | null) => (iso ? dateFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const body = {
      callOutsOn: f.get('callOutsOn') === 'on',
      patrolsOn: f.get('patrolsOn') === 'on',
      season: { start: `${f.get('startM')}-${f.get('startD')}`, end: `${f.get('endM')}-${f.get('endD')}` },
      callOuts: { responseMinutes: n('response'), minRestHours: n('rest') },
      patrols: { graceMinutes: n('grace') },
    };
    if ((await run('save', () => api('/api/winter/settings', { method: 'PUT', body }), t('winter.saved'))) !== undefined) {
      await settings.reload();
      await reloadMe(); // menus change when call-outs or patrols are switched
    }
  }
  async function addRoute(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = { name: String(f.get('name')), roadClass: String(f.get('roadClass') || '') || null, intervalHours: Number(f.get('interval')) };
    if ((await run('route', () => api('/api/winter/routes', { method: 'POST', body }), t('winter.routeAdded'))) !== undefined) {
      form.reset();
      await routes.reload();
    }
  }
  async function exportCsv() {
    const r = await apiDownload(`/api/patrols/export?from=${range.from}&to=${range.to}`);
    if (r.ok) saveBlob(r.blob, `patrols-${range.from}-${range.to}.csv`);
    else toast(t('common.error'), 'warn');
  }

  const s = settings.data;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('winter.title')} description={t('winter.description')} />
      {!s ? (
        <Skeleton className="h-64" />
      ) : manage ? (
        <Card>
          <CardHeader title={t('winter.settings')} description={t('winter.settingsHelp')} />
          <CardBody className="pt-2">
            <form className="grid gap-5" onSubmit={(e) => void save(e)}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['callOutsOn', 'patrolsOn'] as const).map((k) => (
                  <label key={k} className="flex items-start gap-3 rounded-xl border border-line p-4 text-small">
                    <input type="checkbox" name={k} defaultChecked={s[k]} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
                    <span><span className="font-semibold">{t(`winter.${k}`)}</span><span className="block text-caption text-muted">{t(`winter.${k}Help`)}</span></span>
                  </label>
                ))}
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-small font-semibold">{t('winter.season')}</legend>
                <p className="text-caption text-muted">{t('winter.seasonHelp')}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('winter.from')}>{(p) => <Select {...p} name="startM" defaultValue={s.season.start.slice(0, 2)}>{MONTHS.map((m) => <option key={m} value={m}>{month(m)}</option>)}</Select>}</Field>
                  <Field label={t('winter.day')}>{(p) => <Select {...p} name="startD" defaultValue={s.season.start.slice(3)}>{DAYS.map((d) => <option key={d} value={d}>{Number(d)}</option>)}</Select>}</Field>
                  <Field label={t('winter.to')}>{(p) => <Select {...p} name="endM" defaultValue={s.season.end.slice(0, 2)}>{MONTHS.map((m) => <option key={m} value={m}>{month(m)}</option>)}</Select>}</Field>
                  <Field label={t('winter.day')}>{(p) => <Select {...p} name="endD" defaultValue={s.season.end.slice(3)}>{DAYS.map((d) => <option key={d} value={d}>{Number(d)}</option>)}</Select>}</Field>
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('winter.response')} hint={t('winter.responseHint')}>{(p) => <Select {...p} name="response" defaultValue={String(s.callOuts.responseMinutes)}>{[5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{t('winter.minutes', { count: m })}</option>)}</Select>}</Field>
                <Field label={t('winter.rest')} hint={t('winter.restHint')}>{(p) => <Select {...p} name="rest" defaultValue={String(s.callOuts.minRestHours)}>{[0, 4, 6, 8, 10, 12].map((h) => <option key={h} value={h}>{t('winter.hours', { count: h })}</option>)}</Select>}</Field>
                <Field label={t('winter.grace')} hint={t('winter.graceHint')}>{(p) => <Select {...p} name="grace" defaultValue={String(s.patrols.graceMinutes)}>{[0, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{t('winter.minutes', { count: m })}</option>)}</Select>}</Field>
              </div>
              <Button type="submit" loading={busy === 'save'} className="justify-self-start">{t('common.save')}</Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {s?.patrolsOn ? (
        <Card>
          <CardHeader title={t('winter.routes')} description={t('winter.routesHelp')} />
          <CardBody className="grid gap-4 pt-2">
            {!routes.data ? (
              <Skeleton className="h-24" />
            ) : !routes.data.length ? (
              <EmptyState icon={Snowflake} title={t('winter.noRoutes')}>{t('winter.noRoutesHelp')}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {routes.data.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
                    <div>
                      <p className="font-semibold">{r.name}{r.roadClass ? <span className="ml-2 text-caption text-muted">{t('winter.class', { c: r.roadClass })}</span> : null}</p>
                      <p className="text-caption text-muted">{t('winter.routeTimes', { count: r.intervalHours, last: when(r.lastPatrolAt), due: when(r.dueAt) })}</p>
                    </div>
                    {!r.active ? <StatusPill tone="neutral">{t('winter.inactive')}</StatusPill> : r.overdue ? <StatusPill tone="danger">{t('winter.overdue')}</StatusPill> : r.inSeason ? <StatusPill tone="ok">{t('winter.onTrack')}</StatusPill> : <StatusPill tone="neutral">{t('winter.offSeason')}</StatusPill>}
                  </li>
                ))}
              </ul>
            )}
            {manage ? (
              <form className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={(e) => void addRoute(e)}>
                <Field label={t('winter.routeName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={80} placeholder={t('winter.routePlaceholder')} />}</Field>
                <Field label={t('winter.roadClass')} hint={t('common.optional')}>{(p) => <Input {...p} name="roadClass" maxLength={20} />}</Field>
                <Field label={t('winter.interval')}>{(p) => <Select {...p} name="interval" defaultValue="24">{[2, 4, 8, 12, 24, 48, 72, 168, 336, 720].map((h) => <option key={h} value={h}>{t('winter.everyHours', { count: h })}</option>)}</Select>}</Field>
                <Button type="submit" loading={busy === 'route'} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('winter.addRoute')}</Button>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {s?.patrolsOn && can('winter.records') ? (
        <Card>
          <CardHeader title={t('winter.records')} description={t('winter.recordsHelp')} action={<Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void exportCsv()}>{t('winter.export')}</Button>} />
          <CardBody className="grid gap-4 pt-2">
            <div className="flex flex-wrap gap-3">
              <Field label={t('winter.from')}>{(p) => <Input {...p} type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />}</Field>
              <Field label={t('winter.to')}>{(p) => <Input {...p} type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />}</Field>
            </div>
            {!records.data ? (
              <Skeleton className="h-24" />
            ) : !records.data.length ? (
              <p className="text-small text-muted">{t('winter.noRecords')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-small">
                  <thead className="text-left text-caption text-muted"><tr>{['route', 'person', 'when', 'conditions', 'actions', 'material'].map((k) => <th key={k} className="py-2 pr-3 font-semibold">{t(`winter.col.${k}`)}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {records.data.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-semibold">{r.route}</td>
                        <td className="py-2 pr-3">{r.person}</td>
                        <td className="py-2 pr-3">{when(r.startedAt)}{r.endedAt ? '' : ` · ${t('winter.inProgress')}`}</td>
                        <td className="py-2 pr-3">{r.conditions.map((c) => t(`winter.cond.${c}`)).join(', ')}</td>
                        <td className="py-2 pr-3">{r.actions.map((c) => t(`winter.act.${c}`)).join(', ')}</td>
                        <td className="py-2 pr-3">{r.materialTonnes != null ? `${r.materialTonnes} t` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
