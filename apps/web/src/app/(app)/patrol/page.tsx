'use client';

import { Flag, Snowflake } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { currentPosition } from '@/lib/loneWork';
import { useAction, useQuery } from '@/lib/useQuery';
import { ACTIONS, CONDITIONS, type Patrol, type RouteStatus, chip } from '@/lib/winter';
import { formatMoment } from '@/lib/format';

/** A winter patrol: start it on a route, then record the conditions and what was done. */
export default function PatrolPage() {
  const { t, i18n } = useTranslation();
  const mine = useQuery<Patrol[]>('/api/me/patrols');
  const routes = useQuery<RouteStatus[]>('/api/winter/routes');
  const { run, busy } = useAction();
  const [cond, setCond] = useState<Set<string>>(new Set());
  const [acts, setActs] = useState<Set<string>>(new Set(['INSPECTED']));
  const open = mine.data?.find((p) => !p.endedAt);
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    setter(n);
  };
  const when = (iso: string) => formatMoment(iso, i18n.language);
  const num = (f: FormData, k: string) => (String(f.get(k) ?? '').trim() === '' ? null : Number(String(f.get(k)).replace(',', '.')));

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pos = await currentPosition();
    await run('start', () => api('/api/patrols', { method: 'POST', body: { routeId: String(f.get('route')), vehicle: String(f.get('vehicle') || '') || null, startLat: pos?.latitude ?? null, startLng: pos?.longitude ?? null } }), t('patrol.started'));
    await mine.reload();
  }
  async function finish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pos = await currentPosition();
    const body = { conditions: [...cond], actions: [...acts], snowCm: num(f, 'snow'), airTempC: num(f, 'air'), roadTempC: num(f, 'road'), materialTonnes: num(f, 'material'), notes: String(f.get('notes') || '') || null, endLat: pos?.latitude ?? null, endLng: pos?.longitude ?? null };
    if ((await run('finish', () => api(`/api/patrols/${open!.id}/finish`, { method: 'POST', body }), t('patrol.saved'))) !== undefined) {
      setCond(new Set());
      setActs(new Set(['INSPECTED']));
      await mine.reload();
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('patrol.title')} description={t('patrol.description')} />
      {!mine.data || !routes.data ? (
        <Skeleton className="h-64" />
      ) : open ? (
        <Card className="max-w-2xl">
          <CardHeader title={t('patrol.onRoute', { route: open.route })} description={t('patrol.since', { time: when(open.startedAt) })} />
          <CardBody className="pt-2">
            <form className="grid gap-5" onSubmit={(e) => void finish(e)}>
              <fieldset className="grid gap-2">
                <legend className="text-small font-semibold">{t('patrol.conditions')}</legend>
                <div className="flex flex-wrap gap-2">{CONDITIONS.map((c) => <label key={c} className={chip(cond.has(c))}><input type="checkbox" className="sr-only" checked={cond.has(c)} onChange={() => flip(cond, setCond, c)} />{t(`winter.cond.${c}`)}</label>)}</div>
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="text-small font-semibold">{t('patrol.actions')}</legend>
                <div className="flex flex-wrap gap-2">{ACTIONS.map((c) => <label key={c} className={chip(acts.has(c))}><input type="checkbox" className="sr-only" checked={acts.has(c)} onChange={() => flip(acts, setActs, c)} />{t(`winter.act.${c}`)}</label>)}</div>
              </fieldset>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label={t('patrol.snow')}>{(p) => <Input {...p} name="snow" inputMode="decimal" />}</Field>
                <Field label={t('patrol.air')}>{(p) => <Input {...p} name="air" inputMode="decimal" />}</Field>
                <Field label={t('patrol.road')}>{(p) => <Input {...p} name="road" inputMode="decimal" />}</Field>
                <Field label={t('patrol.material')}>{(p) => <Input {...p} name="material" inputMode="decimal" />}</Field>
              </div>
              <Field label={t('patrol.notes')} hint={t('patrol.notesHint')}>{(p) => <Textarea {...p} name="notes" maxLength={1000} rows={3} />}</Field>
              <Button type="submit" size="lg" loading={busy === 'finish'} disabled={!cond.size || !acts.size} icon={<Flag className="h-5 w-5" aria-hidden="true" />} className="justify-self-start">{t('patrol.finish')}</Button>
            </form>
          </CardBody>
        </Card>
      ) : !routes.data.filter((r) => r.active).length ? (
        <EmptyState icon={Snowflake} title={t('winter.noRoutes')}>{t('patrol.askForRoutes')}</EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader title={t('patrol.start')} />
          <CardBody className="pt-2">
            <form className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end" onSubmit={(e) => void start(e)}>
              <Field label={t('patrol.route')}>{(p) => <Select {...p} name="route" required>{routes.data!.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.overdue ? `⚠ ${r.name}` : r.name}</option>)}</Select>}</Field>
              <Field label={t('patrol.vehicle')} hint={t('common.optional')}>{(p) => <Input {...p} name="vehicle" maxLength={40} />}</Field>
              <Button type="submit" loading={busy === 'start'} icon={<Snowflake className="h-4 w-4" aria-hidden="true" />}>{t('patrol.go')}</Button>
            </form>
          </CardBody>
        </Card>
      )}
      {mine.data?.filter((p) => p.endedAt).length ? (
        <Card>
          <CardHeader title={t('patrol.recent')} />
          <CardBody className="pt-1">
            <ul className="divide-y divide-line text-small">
              {mine.data.filter((p) => p.endedAt).map((p) => (
                <li key={p.id} className="py-2.5"><span className="font-semibold">{p.route}</span> · {when(p.startedAt)}<span className="block text-caption text-muted">{[...p.conditions.map((c) => t(`winter.cond.${c}`)), ...p.actions.map((c) => t(`winter.act.${c}`))].join(' · ')}</span></li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
