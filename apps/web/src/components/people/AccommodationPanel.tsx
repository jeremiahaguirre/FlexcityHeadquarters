'use client';

import { Plus, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, dateFormat } from '@/lib/format';
import { useAction, useQuery } from '@/lib/useQuery';

export interface Restriction { id: string; status: 'ACTIVE' | 'CLOSED'; label: string; startsOn: string; endsOn: string | null; reviewOn: string | null; maxShiftHours: number | null; maxWeeklyHours: number | null; noStartBefore: number | null; noEndAfter: number | null; daysOff: number[]; excludedPositionIds: string[] }

const hm = (m: number | null) => (m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const toMin = (v: FormDataEntryValue | null) => {
  const s = String(v || '');
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h! * 60 + m!;
};

/** Plain-language summary of the restrictions, for HR and for the employee. */
export function RestrictionSummary({ r }: { r: Restriction }) {
  const { t, i18n } = useTranslation();
  const days = (n: number) => dateFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + n)));
  const parts = [
    r.maxShiftHours !== null ? t('accommodation.maxShift', { h: r.maxShiftHours }) : null,
    r.maxWeeklyHours !== null ? t('accommodation.maxWeek', { h: r.maxWeeklyHours }) : null,
    r.noStartBefore !== null ? t('accommodation.notBefore', { time: hm(r.noStartBefore) }) : null,
    r.noEndAfter !== null ? t('accommodation.notAfter', { time: hm(r.noEndAfter) }) : null,
    r.daysOff.length ? t('accommodation.daysOffList', { days: r.daysOff.map(days).join(', ') }) : null,
    r.excludedPositionIds.length ? t('accommodation.positionsExcluded', { count: r.excludedPositionIds.length }) : null,
  ].filter(Boolean);
  return <p className="text-small">{parts.join(' · ') || t('accommodation.noLimits')}</p>;
}

/** HR only: the person's accommodation and return-to-work restrictions, which the scheduler enforces. */
export function AccommodationPanel({ userId, positions }: { userId: string; positions: Array<{ id: string; name: string }> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const list = useQuery<Restriction[]>(`/api/users/${userId}/accommodations`);
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const d = (iso: string) => formatDate(`${iso}T12:00:00`, lng, 'dated');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    const body = {
      label: String(f.get('label')),
      startsOn: String(f.get('startsOn')),
      endsOn: String(f.get('endsOn') || '') || null,
      reviewOn: String(f.get('reviewOn') || '') || null,
      maxShiftHours: num('maxShift'),
      maxWeeklyHours: num('maxWeek'),
      noStartBefore: toMin(f.get('notBefore')),
      noEndAfter: toMin(f.get('notAfter')),
      daysOff: [0, 1, 2, 3, 4, 5, 6].filter((n) => f.get(`day${n}`) === 'on'),
      excludedPositionIds: positions.filter((p) => f.get(`pos${p.id}`) === 'on').map((p) => p.id),
    };
    const ok = await run('acc', () => api(`/api/users/${userId}/accommodations`, { method: 'POST', body }), t('accommodation.saved'));
    if (ok !== undefined) {
      setAdding(false);
      await list.reload();
    }
  }
  if (list.error) return null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title={t('accommodation.title')} description={t('accommodation.help')} action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('accommodation.add')}</Button>} />
      <CardBody className="pt-2">
        {!list.data?.length ? (
          <p className="text-small text-muted">{t('accommodation.none')}</p>
        ) : (
          <ul className="grid gap-2">
            {list.data.map((r) => (
              <li key={r.id} className={`rounded-xl border border-line px-4 py-3 ${r.status === 'CLOSED' ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{r.label}</p>
                  <StatusPill tone={r.status === 'ACTIVE' ? 'brand' : 'neutral'}>{t(`accommodation.status.${r.status}`)}</StatusPill>
                </div>
                <p className="text-caption text-muted">{t('accommodation.dates', { from: d(r.startsOn), to: r.endsOn ? d(r.endsOn) : t('accommodation.untilReview') })}{r.reviewOn ? ` · ${t('accommodation.review', { date: d(r.reviewOn) })}` : ''}</p>
                <RestrictionSummary r={r} />
                {r.status === 'ACTIVE' ? <button type="button" className="mt-1 text-caption font-semibold text-brand-text hover:underline" onClick={() => void run(r.id, () => api(`/api/accommodations/${r.id}`, { method: 'PATCH', body: { close: true } }), t('accommodation.closed')).then(() => list.reload())}>{t('accommodation.close')}</button> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 flex gap-2 text-caption text-muted"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />{t('accommodation.privacy')}</p>
      </CardBody>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('accommodation.add')} description={t('accommodation.addHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void save(e)}>
          <Field label={t('accommodation.label')} hint={t('accommodation.labelHint')}>{(p) => <Input {...p} name="label" required minLength={2} maxLength={80} defaultValue={t('accommodation.defaultLabel')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('accommodation.starts')}>{(p) => <Input {...p} name="startsOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />}</Field>
            <Field label={t('accommodation.ends')}>{(p) => <Input {...p} name="endsOn" type="date" />}</Field>
            <Field label={t('accommodation.reviewOn')}>{(p) => <Input {...p} name="reviewOn" type="date" />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('accommodation.maxShiftLabel')}>{(p) => <Input {...p} name="maxShift" type="number" min={1} max={16} step="0.5" />}</Field>
            <Field label={t('accommodation.maxWeekLabel')}>{(p) => <Input {...p} name="maxWeek" type="number" min={1} max={80} step="0.5" />}</Field>
            <Field label={t('accommodation.notBeforeLabel')}>{(p) => <Input {...p} name="notBefore" type="time" />}</Field>
            <Field label={t('accommodation.notAfterLabel')}>{(p) => <Input {...p} name="notAfter" type="time" />}</Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-small font-semibold">{t('accommodation.daysOff')}</legend>
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6, 0].map((n) => (
                <label key={n} className="flex items-center gap-1.5 text-small"><input type="checkbox" name={`day${n}`} className="h-5 w-5 accent-[rgb(var(--brand))]" />{dateFormat(lng, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + n)))}</label>
              ))}
            </div>
          </fieldset>
          {positions.length ? (
            <fieldset>
              <legend className="mb-1 text-small font-semibold">{t('accommodation.noPositions')}</legend>
              <div className="flex flex-wrap gap-3">{positions.map((p) => <label key={p.id} className="flex items-center gap-1.5 text-small"><input type="checkbox" name={`pos${p.id}`} className="h-5 w-5 accent-[rgb(var(--brand))]" />{p.name}</label>)}</div>
            </fieldset>
          ) : null}
          <Button type="submit" loading={busy === 'acc'}>{t('accommodation.save')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}

/** The employee's own active restrictions, so they know what the schedule respects. */
export function MyRestrictions() {
  const { t } = useTranslation();
  const list = useQuery<Restriction[]>('/api/me/accommodations');
  if (!list.data?.length) return null;
  return (
    <Card>
      <CardHeader title={t('accommodation.mine')} description={t('accommodation.mineHelp')} />
      <CardBody className="grid gap-2 pt-2">
        {list.data.map((r) => (
          <div key={r.id} className="rounded-xl bg-surface px-3 py-2"><p className="font-semibold text-small">{r.label}</p><RestrictionSummary r={r} /></div>
        ))}
      </CardBody>
    </Card>
  );
}
