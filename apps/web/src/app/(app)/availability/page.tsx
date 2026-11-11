'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayIso, useAction, useQuery } from '@/lib/useQuery';
import { dateFormat, formatDate } from '@/lib/format';

interface Row { dayOfWeek: number; startMinute: number; endMinute: number; effectiveTo: string | null }
type Window = { start: string; end: string };

const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => (s === '24:00' ? 1440 : Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)));
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, as in Canada

/** When each person can work, week by week. Scheduling only offers shifts inside these times, so the plan-ahead notice asks people to confirm theirs as far ahead as the organization plans. */
export default function AvailabilityPage() {
  const { t, i18n } = useTranslation();
  const rows = useQuery<Row[]>('/api/me/availability');
  const { run, busy } = useAction();
  const [days, setDays] = useState<Record<number, Window[]>>({});
  const [from, setFrom] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState(0);

  useEffect(() => {
    if (!rows.data) return;
    const current = rows.data.filter((r) => r.effectiveTo === null);
    const next: Record<number, Window[]> = {};
    for (const r of current) (next[r.dayOfWeek] ??= []).push({ start: toTime(r.startMinute), end: r.endMinute === 1440 ? '24:00' : toTime(r.endMinute) });
    setDays(next);
  }, [rows.data]);

  const dayName = (d: number) => dateFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  const set = (d: number, w: Window[]) => setDays((x) => ({ ...x, [d]: w }));

  async function save() {
    const windows = Object.entries(days).flatMap(([d, ws]) => ws.map((w) => ({ dayOfWeek: Number(d), startMinute: toMin(w.start), endMinute: toMin(w.end) })));
    if (windows.some((w) => w.endMinute <= w.startMinute)) return setError(t('availability.endBeforeStart'));
    setError(null);
    await run('save', () => api('/api/me/availability', { method: 'PUT', body: { effectiveFrom: from, windows } }), t('availability.saved'));
    await rows.reload();
    setWindowKey((k) => k + 1);
  }

  return (
    <>
      <PageHeader title={t('availability.title')} description={t('availability.description')} />
      <PlanAheadNotice key={windowKey} />
      {rows.loading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card className="divide-y divide-line">
          {ORDER.map((d) => {
            const ws = days[d] ?? [];
            const on = ws.length > 0;
            return (
              <div key={d} className="flex flex-wrap items-start gap-4 p-4">
                <label className="flex w-40 items-center gap-3 pt-2.5 text-body-strong">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => set(d, e.target.checked ? [{ start: '06:00', end: '22:00' }] : [])}
                    className="h-5 w-5 accent-[rgb(var(--brand))]"
                  />
                  <span className="capitalize">{dayName(d)}</span>
                </label>
                <div className="grid min-w-0 flex-1 gap-2">
                  {on ? (
                    ws.map((w, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <div className="w-36">
                          <Input type="time" aria-label={t('availability.from')} value={w.start} onChange={(e) => set(d, ws.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                        </div>
                        <span className="text-muted" aria-hidden="true">–</span>
                        <div className="w-36">
                          <Input type="time" aria-label={t('availability.to')} value={w.end === '24:00' ? '23:59' : w.end} onChange={(e) => set(d, ws.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                        </div>
                        {i > 0 ? (
                          <Button variant="ghost" size="sm" aria-label={t('availability.remove')} onClick={() => set(d, ws.filter((_, j) => j !== i))}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className={cn('pt-2.5 text-small text-muted')}>{t('availability.unavailable')}</p>
                  )}
                  {on && ws.length < 3 ? (
                    <button type="button" onClick={() => set(d, [...ws, { start: '17:00', end: '21:00' }])} className="flex w-fit items-center gap-1.5 rounded-lg text-small font-semibold text-brand-text hover:underline">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('availability.addWindow')}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-end justify-between gap-4 p-4">
            <Field label={t('availability.effectiveFrom')} hint={t('availability.effectiveHint')} error={error ?? undefined} className="w-56">
              {(p) => <Input {...p} type="date" value={from} min={todayIso()} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Button size="lg" loading={busy === 'save'} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

/** "Your city plans 2 weeks ahead — your availability is set through Nov 29", with a quick confirm. */
function PlanAheadNotice() {
  const { t, i18n } = useTranslation();
  const w = useQuery<{ planAheadWeeks: number; through: string; confirmedThrough: string | null; current: boolean }>('/api/me/availability/window');
  const { run, busy } = useAction();
  if (!w.data) return null;
  const date = (iso: string) => formatDate(`${iso}T12:00:00`, i18n.language, 'long');
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl2 border border-line bg-panel px-4 py-3">
      <p className="text-small">
        <span className="block font-semibold">{t('availability.planAhead', { window: t(`fill.horizon.${w.data.planAheadWeeks}`) })}</span>
        <span className="text-muted">
          {w.data.current ? t('availability.setThrough', { date: date(w.data.confirmedThrough ?? w.data.through) }) : w.data.confirmedThrough ? t('availability.confirmedOnlyThrough', { date: date(w.data.confirmedThrough) }) : t('availability.notConfirmed')}
        </span>
      </p>
      {!w.data.current ? (
        <Button size="sm" variant="secondary" loading={busy === 'confirm'} onClick={() => void run('confirm', () => api('/api/me/availability/confirm', { method: 'POST' }), t('availability.confirmed')).then(() => w.reload())}>
          {t('availability.confirm', { date: date(w.data.through) })}
        </Button>
      ) : null}
    </div>
  );
}
