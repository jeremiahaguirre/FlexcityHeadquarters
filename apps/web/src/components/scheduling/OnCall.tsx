'use client';

import { PhoneCall, Plus, Repeat, Siren, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { formatLocal } from '@/lib/localTime';
import { useAction, useQuery } from '@/lib/useQuery';
import { toLocalInput } from '@/lib/winter';
import type { OnCallPeriod, OnCallView } from '@/lib/workRules';

interface Named { id: string; name: string; nameFr: string | null }
interface Person { id: string; name: string; status: string; positions: Array<{ id: string; departmentId: string | null }> }

const isoDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Who's on call when, per department: add, rotate, swap, and call the person on call back in. */
export function OnCall({ canWrite }: { canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [range] = useState(() => ({ from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 42 * 86_400_000) }));
  const q = useQuery<OnCallView>(`/api/schedule/on-call?from=${range.from.toISOString()}&to=${range.to.toISOString()}`);
  const positions = useQuery<Array<Named & { departmentId: string | null }>>('/api/positions');
  const facilities = useQuery<Named[]>('/api/facilities');
  const people = useQuery<Person[]>('/api/users?status=ACTIVE');
  const { run, busy } = useAction();
  const [dept, setDept] = useState('');
  const [dialog, setDialog] = useState<null | 'add' | 'rotate' | 'callback' | { swap: OnCallPeriod }>(null);
  const [emergencyAsk, setEmergencyAsk] = useState(false);
  useEffect(() => {
    if (!dept && q.data?.departments[0]) setDept(q.data.departments[0].id);
  }, [q.data, dept]);
  const label = (x: { name: string; nameFr: string | null }) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const deptPositions = useMemo(() => (positions.data ?? []).filter((p) => p.departmentId === dept), [positions.data, dept]);
  const deptPeople = useMemo(() => (people.data ?? []).filter((p) => p.positions.some((x) => x.departmentId === dept)), [people.data, dept]);
  if (!q.data) return <Skeleton className="h-64" />;
  if (!q.data.departments.length) return <EmptyState icon={PhoneCall} title={t('onCall.noDepartments')}>{t('onCall.noDepartmentsHelp')}</EmptyState>;
  const periods = q.data.periods.filter((p) => p.departmentId === dept);
  const fmt = (iso: string) => formatLocal(iso, i18n.language, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const close = () => {
    setDialog(null);
    setEmergencyAsk(false);
  };
  const reload = () => q.reload();

  async function submit(e: React.FormEvent<HTMLFormElement>, kind: 'add' | 'rotate' | 'callback') {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (kind === 'add') {
      const body = { departmentId: dept, userId: String(f.get('person')), startsAt: new Date(String(f.get('start'))).toISOString(), endsAt: new Date(String(f.get('end'))).toISOString(), note: String(f.get('note') || '') || null };
      if ((await run('add', () => api('/api/schedule/on-call', { method: 'POST', body }), t('onCall.added'))) !== undefined) {
        close();
        await reload();
      }
    } else if (kind === 'rotate') {
      const body = { departmentId: dept, userIds: f.getAll('people').map(String), startDate: String(f.get('startDate')), periods: Number(f.get('periods')), days: Number(f.get('days')), startHour: Number(f.get('startHour')) };
      if ((await run('rotate', () => api('/api/schedule/on-call/rotate', { method: 'POST', body }), t('onCall.rotated'))) !== undefined) {
        close();
        await reload();
      }
    } else {
      const body = { departmentId: dept, userId: String(f.get('person') || '') || undefined, positionId: String(f.get('position')), facilityId: String(f.get('facility')), startsAt: new Date(String(f.get('start'))).toISOString(), endsAt: new Date(String(f.get('end'))).toISOString(), reason: String(f.get('reason')), emergency: f.get('emergency') === 'on' };
      try {
        const r = await api<{ nextShiftTooSoon: { startsAt: string } | null; emergencyOverride: boolean }>('/api/schedule/on-call/call-back', { method: 'POST', body });
        toast(r.nextShiftTooSoon ? t('onCall.callbackRestWarn') : t('onCall.calledBack'), r.nextShiftTooSoon ? 'warn' : 'ok');
        close();
        await reload();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'CALLBACK_REST') setEmergencyAsk(true);
        toast(err instanceof ApiError ? t(`errors.${err.code}`, { defaultValue: err.message }) : t('common.error'), 'warn');
      }
    }
  }

  const now = new Date();
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
        <Field label={t('onCall.department')} className="sm:w-64">
          {(p) => <Select {...p} value={dept} onChange={(e) => setDept(e.target.value)}>{q.data!.departments.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}</Select>}
        </Field>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('add')}>{t('onCall.add')}</Button>
            <Button variant="secondary" icon={<Repeat className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('rotate')}>{t('onCall.rotate')}</Button>
            <Button variant="secondary" icon={<Siren className="h-4 w-4" aria-hidden="true" />} onClick={() => setDialog('callback')}>{t('onCall.callBack')}</Button>
          </div>
        ) : null}
      </div>
      <Card>
        <CardHeader title={t('onCall.roster')} description={t('onCall.rosterHelp')} />
        <CardBody className="pt-1">
          {!periods.length ? (
            <p className="text-small text-muted">{t('onCall.none')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {periods.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {p.name} {p.now ? <StatusPill tone="ok">{t('onCall.now')}</StatusPill> : null}
                    </p>
                    <p className="text-caption text-muted">{fmt(p.localStartsAt)} – {fmt(p.localEndsAt)}{p.note ? ` · ${p.note}` : ''}</p>
                    {p.now && p.phone ? <a className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline" href={`tel:${p.phone}`}>{p.phone}</a> : null}
                  </div>
                  {canWrite && new Date(p.endsAt) > now ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ swap: p })}>{t('onCall.swap')}</Button>
                      <Button size="sm" variant="ghost" aria-label={t('onCall.remove', { name: p.name })} loading={busy === p.id} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(p.id, () => api(`/api/schedule/on-call/${p.id}`, { method: 'DELETE' }), t('onCall.removed')).then(reload)} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption text-muted">{t('onCall.foot')}</p>
        </CardBody>
      </Card>

      <Dialog open={dialog === 'add'} onClose={close} title={t('onCall.add')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void submit(e, 'add')}>
          <Field label={t('onCall.person')}>{(p) => <Select {...p} name="person" required>{deptPeople.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('onCall.starts')}>{(p) => <Input {...p} name="start" type="datetime-local" required defaultValue={toLocalInput(new Date(new Date().setHours(8, 0, 0, 0) + 86_400_000))} />}</Field>
            <Field label={t('onCall.ends')}>{(p) => <Input {...p} name="end" type="datetime-local" required defaultValue={toLocalInput(new Date(new Date().setHours(8, 0, 0, 0) + 8 * 86_400_000))} />}</Field>
          </div>
          <Field label={t('onCall.note')}>{(p) => <Input {...p} name="note" maxLength={200} />}</Field>
          <Button type="submit" loading={busy === 'add'} className="justify-self-start">{t('onCall.add')}</Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'rotate'} onClose={close} title={t('onCall.rotate')} description={t('onCall.rotateHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void submit(e, 'rotate')}>
          <Field label={t('onCall.inTurn')}>{(p) => <MultiSelect id={p.id} name="people" options={deptPeople.map((x) => ({ value: x.id, label: x.name }))} placeholder={t('onCall.pickPeople')} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('onCall.startDate')}>{(p) => <Input {...p} name="startDate" type="date" required defaultValue={isoDay(new Date(Date.now() + 86_400_000))} />}</Field>
            <Field label={t('onCall.startHour')}>{(p) => <Input {...p} name="startHour" type="number" inputMode="numeric" min={0} max={23} defaultValue={8} />}</Field>
            <Field label={t('onCall.periods')}>{(p) => <Input {...p} name="periods" type="number" inputMode="numeric" min={1} max={26} defaultValue={4} />}</Field>
            <Field label={t('onCall.days')}>{(p) => <Input {...p} name="days" type="number" inputMode="numeric" min={1} max={14} defaultValue={7} />}</Field>
          </div>
          <Button type="submit" loading={busy === 'rotate'} className="justify-self-start">{t('onCall.rotate')}</Button>
        </form>
      </Dialog>

      <Dialog open={dialog === 'callback'} onClose={close} title={t('onCall.callBack')} description={t('onCall.callBackHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void submit(e, 'callback')}>
          <Field label={t('onCall.reason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} placeholder={t('onCall.reasonPlaceholder')} />}</Field>
          <Field label={t('onCall.person')} hint={t('onCall.personDefault')}>
            {(p) => (
              <Select {...p} name="person">
                <option value="">{t('onCall.whoeverOnCall')}</option>
                {deptPeople.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('onCall.position')}>{(p) => <Select {...p} name="position" required>{deptPositions.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>}</Field>
            <Field label={t('onCall.facility')}>{(p) => <Select {...p} name="facility" required>{(facilities.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label={t('onCall.starts')}>{(p) => <Input {...p} name="start" type="datetime-local" required defaultValue={toLocalInput(new Date(Date.now() + 30 * 60_000))} />}</Field>
            <Field label={t('onCall.ends')}>{(p) => <Input {...p} name="end" type="datetime-local" required defaultValue={toLocalInput(new Date(Date.now() + 3.5 * 3_600_000))} />}</Field>
          </div>
          {emergencyAsk ? (
            <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-3 text-small">
              <input type="checkbox" name="emergency" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
              <span><span className="block font-semibold">{t('onCall.emergency')}</span><span className="text-caption text-muted">{t('onCall.emergencyHelp')}</span></span>
            </label>
          ) : null}
          <Button type="submit" className="justify-self-start" icon={<Siren className="h-4 w-4" aria-hidden="true" />}>{t('onCall.callBack')}</Button>
        </form>
      </Dialog>

      <Dialog open={typeof dialog === 'object' && dialog !== null} onClose={close} title={t('onCall.swap')} description={t('onCall.swapHelp')} closeLabel={t('common.close')}>
        {typeof dialog === 'object' && dialog ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const v = String(f.get('with'));
              const body = v.startsWith('p:') ? { withId: v.slice(2) } : { userId: v.slice(2) };
              void run('swap', () => api(`/api/schedule/on-call/${dialog.swap.id}/swap`, { method: 'POST', body }), t('onCall.swapped')).then((r) => {
                if (r !== undefined) {
                  close();
                  void reload();
                }
              });
            }}
          >
            <Field label={t('onCall.swapWith')}>
              {(p) => (
                <Select {...p} name="with" required>
                  <optgroup label={t('onCall.tradeWith')}>
                    {periods.filter((x) => x.id !== dialog.swap.id && x.userId !== dialog.swap.userId).map((x) => <option key={x.id} value={`p:${x.id}`}>{`${x.name} · ${fmt(x.localStartsAt)}`}</option>)}
                  </optgroup>
                  <optgroup label={t('onCall.giveTo')}>
                    {deptPeople.filter((x) => x.id !== dialog.swap.userId).map((x) => <option key={x.id} value={`u:${x.id}`}>{x.name}</option>)}
                  </optgroup>
                </Select>
              )}
            </Field>
            <Button type="submit" loading={busy === 'swap'} className="justify-self-start">{t('onCall.swap')}</Button>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
