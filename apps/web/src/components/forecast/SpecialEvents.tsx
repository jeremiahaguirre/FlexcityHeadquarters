'use client';

import { CalendarDays, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { dateFormat } from '@/lib/format';
import { pct } from '@/lib/forecast';
import { useAction, useQuery } from '@/lib/useQuery';

export interface SpecialEvent {
  id: string;
  facilityId: string | null;
  name: string;
  startsOn: string;
  endsOn: string;
  startMinute: number | null;
  endMinute: number | null;
  extraPeople: number | null;
  percent: number | null;
  recursYearly: boolean;
  notes: string | null;
}

const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinute = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Special events for the forecast: a swim meet, a tournament, Canada Day. Extra people expected at
 * a time while it runs, or a percentage up or down; this facility or every facility; once or yearly.
 * Statutory holidays come in by themselves and aren't listed here.
 */
export function SpecialEvents({ facilityId, defaultDate, onChanged }: { facilityId: string; defaultDate: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const events = useQuery<SpecialEvent[]>(`/api/forecast/events?facilityId=${facilityId}`);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<SpecialEvent | 'new' | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [effect, setEffect] = useState<'extra' | 'percent'>('extra');
  const current = editing === 'new' ? null : editing;
  const open = (e: SpecialEvent | 'new') => {
    setEditing(e);
    setAllDay(e === 'new' || e.startMinute === null);
    setEffect(e !== 'new' && e.percent !== null && e.extraPeople === null ? 'percent' : 'extra');
  };
  const date = (iso: string) => dateFormat(lng, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  const clock = (m: number) => dateFormat(lng, { hour: 'numeric', minute: m % 60 ? '2-digit' : undefined, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, Math.floor(m / 60), m % 60)));
  const effectText = (e: SpecialEvent) => [e.extraPeople ? t('forecast.events.extra', { count: e.extraPeople }) : '', e.percent ? pct(e.percent, lng) : ''].filter(Boolean).join(' · ');

  async function save(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const n = (k: string) => (String(f.get(k) ?? '').trim() === '' ? null : Number(f.get(k)));
    const value = n('amount');
    const body = {
      facilityId: f.get('where') === 'city' ? null : facilityId,
      name: String(f.get('name') ?? '').trim(),
      startsOn: String(f.get('startsOn')),
      endsOn: String(f.get('endsOn') || f.get('startsOn')),
      startMinute: allDay ? null : toMinute(String(f.get('from'))),
      endMinute: allDay ? null : toMinute(String(f.get('to'))),
      extraPeople: effect === 'extra' ? value : null,
      percent: effect === 'percent' ? value : null,
      recursYearly: f.get('yearly') === 'on',
      notes: String(f.get('notes') ?? '').trim() || null,
    };
    const r = await run('save', () => (current ? api(`/api/forecast/events/${current.id}`, { method: 'PATCH', body }) : api('/api/forecast/events', { method: 'POST', body })), t('forecast.events.saved'));
    if (r !== undefined) {
      setEditing(null);
      await events.reload();
      onChanged();
    }
  }
  async function remove(e: SpecialEvent) {
    const r = await run(`del-${e.id}`, () => api(`/api/forecast/events/${e.id}`, { method: 'DELETE' }), t('forecast.events.removed'));
    if (r !== undefined) {
      await events.reload();
      onChanged();
    }
  }

  const list = events.data ?? [];
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('forecast.events.title')}</span>}
        description={t('forecast.events.help')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => open('new')}>{t('forecast.events.add')}</Button>}
      />
      <CardBody>
        {!events.data ? null : !list.length ? (
          <p className="text-small text-muted">{t('forecast.events.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-body-strong">{e.name}</p>
                  <p className="text-small text-muted">
                    {e.startsOn === e.endsOn ? date(e.startsOn) : t('forecast.events.range', { from: date(e.startsOn), to: date(e.endsOn) })}
                    {e.startMinute !== null && e.endMinute !== null ? ` · ${clock(e.startMinute)}–${clock(e.endMinute)}` : ` · ${t('forecast.events.allDay')}`}
                    {` · ${effectText(e)}`}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <StatusPill tone={e.facilityId ? 'neutral' : 'brand'}>{e.facilityId ? t('forecast.events.thisFacility') : t('forecast.events.wholeCity')}</StatusPill>
                    {e.recursYearly ? <StatusPill tone="neutral" icon={<Repeat className="h-3.5 w-3.5" aria-hidden="true" />}>{t('forecast.events.yearly')}</StatusPill> : null}
                  </div>
                  {e.notes ? <p className="mt-1 text-small text-muted">{e.notes}</p> : null}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" aria-label={t('forecast.events.edit', { name: e.name })} className="min-w-[44px] sm:min-w-0" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => open(e)} />
                  <Button size="sm" variant="secondary" aria-label={t('forecast.events.remove', { name: e.name })} loading={busy === `del-${e.id}`} className="min-w-[44px] sm:min-w-0" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void remove(e)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? current.name : t('forecast.events.add')} description={t('forecast.events.dialogHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? `new-${defaultDate}`} onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field label={t('forecast.events.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={120} autoComplete="off" defaultValue={current?.name ?? ''} placeholder={t('forecast.events.namePlaceholder')} />}</Field>
          <Field label={t('forecast.events.where')}>
            {(p) => (
              <Select {...p} name="where" defaultValue={current && current.facilityId === null ? 'city' : 'facility'}>
                <option value="facility">{t('forecast.events.thisFacility')}</option>
                <option value="city">{t('forecast.events.wholeCity')}</option>
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('forecast.events.startsOn')}>{(p) => <Input {...p} name="startsOn" type="date" required defaultValue={current?.startsOn ?? defaultDate} />}</Field>
            <Field label={t('forecast.events.endsOn')}>{(p) => <Input {...p} name="endsOn" type="date" defaultValue={current?.endsOn ?? defaultDate} />}</Field>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-small text-ink">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
            {t('forecast.events.allDay')}
          </label>
          {!allDay ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('forecast.events.from')}>{(p) => <Input {...p} name="from" type="time" required defaultValue={current?.startMinute != null ? toTime(current.startMinute) : '10:00'} />}</Field>
              <Field label={t('forecast.events.to')}>{(p) => <Input {...p} name="to" type="time" required defaultValue={current?.endMinute != null ? toTime(current.endMinute) : '16:00'} />}</Field>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('forecast.events.effect')}>
              {(p) => (
                <Select {...p} value={effect} onChange={(e) => setEffect(e.target.value as 'extra' | 'percent')}>
                  <option value="extra">{t('forecast.events.effectExtra')}</option>
                  <option value="percent">{t('forecast.events.effectPercent')}</option>
                </Select>
              )}
            </Field>
            <Field label={effect === 'extra' ? t('forecast.events.extraLabel') : t('forecast.events.percentLabel')} hint={effect === 'percent' ? t('forecast.events.percentHint') : t('forecast.events.extraHint')}>
              {(p) =>
                effect === 'extra' ? (
                  <Input {...p} key="extra" name="amount" type="number" min={1} max={100000} step={1} required defaultValue={current?.extraPeople ?? ''} />
                ) : (
                  <Input {...p} key="percent" name="amount" type="number" min={-90} max={300} step={1} required defaultValue={current?.percent ?? ''} />
                )
              }
            </Field>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-small text-ink">
            <input type="checkbox" name="yearly" defaultChecked={current?.recursYearly ?? false} className="h-5 w-5 accent-[rgb(var(--brand))]" />
            {t('forecast.events.yearlyLabel')}
          </label>
          <Field label={t('forecast.events.notes')}>{(p) => <Textarea {...p} name="notes" rows={2} maxLength={500} defaultValue={current?.notes ?? ''} />}</Field>
          <Button type="submit" loading={busy === 'save'}>{t('common.save')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}
