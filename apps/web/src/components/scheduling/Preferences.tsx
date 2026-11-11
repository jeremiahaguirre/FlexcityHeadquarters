'use client';

import { Heart, HeartOff, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { type PreferenceWindow, fromHHMM, toHHMM } from '@/lib/shiftTemplates';
import { useAction, useQuery } from '@/lib/useQuery';
import { DayToggles } from './ShiftTemplates';

interface Named { id: string; name: string; nameFr?: string | null }
interface Mine { preferences: PreferenceWindow[]; maxWeeklyHours: number | null; maxDaysPerWeek: number | null; updatedAt: string | null; positions: Named[]; facilities: Named[] }

function WindowRow({ w, positions, facilities, onChange, onRemove }: { w: PreferenceWindow; positions: Named[]; facilities: Named[]; onChange: (w: PreferenceWindow) => void; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  const label = (x: Named) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const anyTime = w.startMinute === null;
  return (
    <li className="grid gap-3 rounded-2xl border border-line p-3">
      <DayToggles value={w.daysOfWeek} onChange={(daysOfWeek) => onChange({ ...w, daysOfWeek })} label={t('prefs.days')} />
      {w.daysOfWeek.length ? null : <p className="-mt-1 text-caption text-muted">{t('prefs.anyDayHint')}</p>}
      <label className="flex min-h-11 items-center gap-3 text-small">
        <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={anyTime} onChange={(e) => onChange(e.target.checked ? { ...w, startMinute: null, endMinute: null } : { ...w, startMinute: 7 * 60, endMinute: 12 * 60 })} />
        {t('prefs.anyTime')}
      </label>
      {!anyTime ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('prefs.startsFrom')}>{(p) => <Input {...p} type="time" value={toHHMM(w.startMinute!)} onChange={(e) => { const m = fromHHMM(e.target.value); if (m !== null) onChange({ ...w, startMinute: m, endMinute: Math.max(m + 15, w.endMinute ?? m + 60) }); }} />}</Field>
          <Field label={t('prefs.startsBefore')}>{(p) => <Input {...p} type="time" value={toHHMM(Math.min(w.endMinute!, 1439))} onChange={(e) => { const m = fromHHMM(e.target.value); if (m !== null && m > w.startMinute!) onChange({ ...w, endMinute: m }); }} />}</Field>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('prefs.position')}>
          {(p) => (
            <Select {...p} value={w.positionId ?? ''} onChange={(e) => onChange({ ...w, positionId: e.target.value || null })}>
              <option value="">{t('prefs.anyPosition')}</option>
              {positions.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('prefs.facility')}>
          {(p) => (
            <Select {...p} value={w.facilityId ?? ''} onChange={(e) => onChange({ ...w, facilityId: e.target.value || null })}>
              <option value="">{t('prefs.anyFacility')}</option>
              {facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t('prefs.note')}>{(p) => <Input {...p} value={w.note ?? ''} maxLength={200} autoComplete="off" placeholder={t(w.kind === 'PREFER' ? 'prefs.notePrefer' : 'prefs.noteAvoid')} onChange={(e) => onChange({ ...w, note: e.target.value })} />}</Field>
      <Button variant="ghost" size="sm" className="justify-self-start" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={onRemove}>{t('prefs.remove')}</Button>
    </li>
  );
}

/** A person's shift preferences: prefer / avoid windows and the most they'd like to work, saved as a whole. */
export function Preferences() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Mine>('/api/me/preferences');
  const { run, busy } = useAction();
  const [windows, setWindows] = useState<PreferenceWindow[]>([]);
  const [hours, setHours] = useState('');
  const [days, setDays] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setWindows(q.data.preferences);
    setHours(q.data.maxWeeklyHours === null ? '' : String(q.data.maxWeeklyHours));
    setDays(q.data.maxDaysPerWeek === null ? '' : String(q.data.maxDaysPerWeek));
    setDirty(false);
  }, [q.data]);
  if (!q.data) return <Skeleton className="h-64" />;
  const edit = (next: PreferenceWindow[]) => {
    setWindows(next);
    setDirty(true);
  };
  const add = (kind: PreferenceWindow['kind']) => edit([...windows, { kind, daysOfWeek: kind === 'AVOID' ? [0] : [1, 2, 3, 4, 5], startMinute: kind === 'PREFER' ? 7 * 60 : null, endMinute: kind === 'PREFER' ? 12 * 60 : null, positionId: null, facilityId: null, note: '' }]);
  const hoursNum = hours === '' ? null : Number(hours);
  const daysNum = days === '' ? null : Number(days);
  const invalid = (hoursNum !== null && (!Number.isFinite(hoursNum) || hoursNum < 1 || hoursNum > 80)) || (daysNum !== null && (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 7));
  const save = () =>
    void run('save', () => api('/api/me/preferences', { method: 'PUT', body: { preferences: windows.map(({ id: _id, ...w }) => ({ ...w, note: w.note?.trim() || null })), maxWeeklyHours: hoursNum, maxDaysPerWeek: daysNum } }), t('prefs.saved')).then((r) => r && q.reload());
  const section = (kind: PreferenceWindow['kind']) => {
    const list = windows.map((w, i) => ({ w, i })).filter((x) => x.w.kind === kind);
    const Icon = kind === 'PREFER' ? Heart : HeartOff;
    return (
      <Card className="max-w-2xl">
        <CardHeader title={<span className="inline-flex items-center gap-2"><Icon className={kind === 'PREFER' ? 'h-5 w-5 text-brand-text' : 'h-5 w-5 text-muted'} aria-hidden="true" />{t(kind === 'PREFER' ? 'prefs.preferTitle' : 'prefs.avoidTitle')}</span>} description={t(kind === 'PREFER' ? 'prefs.preferHelp' : 'prefs.avoidHelp')} />
        <CardBody className="grid gap-3 pt-1">
          {list.length ? (
            <ul className="grid gap-3">
              {list.map(({ w, i }) => (
                <WindowRow key={i} w={w} positions={q.data!.positions} facilities={q.data!.facilities} onChange={(x) => edit(windows.map((y, k) => (k === i ? x : y)))} onRemove={() => edit(windows.filter((_, k) => k !== i))} />
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted">{t(kind === 'PREFER' ? 'prefs.nonePrefer' : 'prefs.noneAvoid')}</p>
          )}
          <Button size="sm" variant="secondary" className="justify-self-start" disabled={windows.length >= 20} icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => add(kind)}>{t(kind === 'PREFER' ? 'prefs.addPrefer' : 'prefs.addAvoid')}</Button>
        </CardBody>
      </Card>
    );
  };
  return (
    <div className="grid gap-4">
      <p className="max-w-2xl rounded-2xl bg-surface p-4 text-small">
        {t('prefs.notAvailability')} <Link href="/availability" className="font-semibold text-brand-text underline underline-offset-2">{t('prefs.availabilityLink')}</Link>
      </p>
      {section('PREFER')}
      {section('AVOID')}
      <Card className="max-w-2xl">
        <CardHeader title={t('prefs.limitsTitle')} description={t('prefs.limitsHelp')} />
        <CardBody className="grid grid-cols-2 gap-3 pt-1">
          <Field label={t('prefs.maxHours')}>{(p) => <Input {...p} type="number" inputMode="decimal" min={1} max={80} step={0.5} value={hours} onChange={(e) => { setHours(e.target.value); setDirty(true); }} />}</Field>
          <Field label={t('prefs.maxDays')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={7} value={days} onChange={(e) => { setDays(e.target.value); setDirty(true); }} />}</Field>
        </CardBody>
      </Card>
      <div className="flex max-w-2xl flex-wrap items-center gap-3">
        <Button loading={busy === 'save'} disabled={!dirty || invalid} onClick={save}>{t('prefs.save')}</Button>
        <p className="text-caption text-muted">{q.data.updatedAt ? t('prefs.updated', { date: formatDate(q.data.updatedAt.slice(0, 10), i18n.language, 'dated') }) : t('prefs.whoSees')}</p>
      </div>
      {q.data.updatedAt ? <p className="max-w-2xl text-caption text-muted">{t('prefs.whoSees')}</p> : null}
    </div>
  );
}
