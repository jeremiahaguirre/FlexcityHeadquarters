'use client';

import { ArrowDown, ArrowUp, CalendarPlus, ChevronLeft, ChevronRight, CloudOff, GraduationCap, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { useQuery } from '@/lib/useQuery';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { OpeningHours } from '@/components/forecast/OpeningHours';
import { dateFormat } from '@/lib/format';
import { Segmented } from '@/components/ui/Segmented';
import { StatusPill } from '@/components/ui/StatusPill';
import { SpecialEvents } from '@/components/forecast/SpecialEvents';
import { WeatherIcon } from '@/components/forecast/WeatherIcon';
import { type Adjustment, type DayWeather, type WeatherInfo, reasonText, temp } from '@/lib/forecast';

type Reason = 'bathers' | 'minimum' | 'lessons' | 'closed';
interface Figures { expected: number; needed: number; gap: number }
interface Hour extends Figures { hour: number; open?: boolean | null; unfilled?: number; scheduled: number; basedOnDays: number; lessons?: { classes: number; swimmers: number }; reasons?: Reason[]; base?: Figures }
interface Day { date: string; schoolDay: boolean; weather?: DayWeather | null; adjustments?: Adjustment[]; hours: Hour[] }
interface Forecast {
  weekStart: string;
  weeksOfHistory: number;
  hoursSet: boolean;
  forLessons: boolean;
  weather?: WeatherInfo;
  days: Day[];
}
type View = 'adjusted' | 'base';
/** The figures for the chosen view: with weather and events, or as the history alone says. */
const fig = (h: Hour, view: View): Figures => (view === 'base' && h.base ? h.base : h);

const monday = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const shift = (iso: string, days: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};

/** Expected bathers and lifeguards needed each hour, against who is scheduled. */
export default function ForecastPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const [facilityId, setFacilityId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [week, setWeek] = useState(monday(new Date(Date.now() + 7 * 86_400_000)));
  const [view, setView] = useState<View>('adjusted');
  useEffect(() => {
    if (!facilityId && facilities.data?.[0]) setFacilityId(facilities.data[0].id);
    if (!positionId && positions.data?.length) setPositionId((positions.data.find((p) => /guard|sauvet/i.test(p.name)) ?? positions.data[0]!).id);
  }, [facilities.data, positions.data, facilityId, positionId]);
  const data = useQuery<Forecast>(facilityId && positionId ? `/api/forecast?facilityId=${facilityId}&weekStart=${week}&positionId=${positionId}` : null);
  const hours = data.data?.days[0]?.hours.map((h) => h.hour) ?? [];
  const label = (iso: string) => dateFormat(lng, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  const hh = (h: number) => dateFormat(lng, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, h)));
  const gaps = data.data?.days.flatMap((d) => d.hours).reduce((s, h) => s + fig(h, view).gap, 0) ?? 0;
  const toDraft = data.data?.days.flatMap((d) => d.hours).reduce((s, h) => s + Math.max(0, h.gap - (h.unfilled ?? 0)), 0) ?? 0;
  const toast = useToast();
  const [drafting, setDrafting] = useState(false);
  const draft = async () => {
    setDrafting(true);
    try {
      const r = await api<{ created: number }>('/api/forecast/draft-shifts', { method: 'POST', body: { facilityId, weekStart: week, positionId } });
      toast(t('forecast.drafted', { count: r.created }), 'ok');
      await data.reload();
    } catch {
      toast(t('forecast.draftFailed'), 'warn');
    } finally {
      setDrafting(false);
    }
  };
  const fr = lng.startsWith('fr');
  const changed = (c: Hour) => view === 'adjusted' && !!c.base && c.base.needed !== c.needed;
  const cellTitle = (c: Hour) =>
    c.open === false
      ? t('forecast.closedTitle')
      : [
          t(data.data?.forLessons ? 'forecast.cellTitleLessons' : 'forecast.cellTitle', { expected: fig(c, view).expected, needed: fig(c, view).needed, scheduled: c.scheduled, days: c.basedOnDays }),
          changed(c) ? t('forecast.withoutTitle', { needed: c.base!.needed, expected: c.base!.expected }) : '',
          c.lessons?.classes ? t('forecast.lessonsTitle', { count: c.lessons.classes, swimmers: c.lessons?.swimmers }) : '',
          c.reasons?.includes('minimum') ? t('forecast.minimumTitle') : '',
          c.unfilled ? t('forecast.unfilledTitle', { count: c.unfilled }) : '',
        ].filter(Boolean).join(' · ');

  return (
    <div className="grid gap-6">
      <PageHeader title={t('forecast.title')} description={t('forecast.description')} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('timeclock.facility')}>{(p) => <Select {...p} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
        <Field label={t('overtime.position')}>{(p) => <Select {...p} value={positionId} onChange={(e) => setPositionId(e.target.value)}>{positions.data?.map((x) => <option key={x.id} value={x.id}>{lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name}</option>)}</Select>}</Field>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label={t('forecast.prev')} onClick={() => setWeek(shift(week, -7))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <span className="min-w-[9rem] text-center text-small font-semibold">{label(week)}</span>
          <Button variant="secondary" size="sm" aria-label={t('forecast.next')} onClick={() => setWeek(shift(week, 7))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </div>
      {facilityId ? <OpeningHours facilityId={facilityId} onSaved={() => void data.reload()} /> : null}
      {facilityId ? <SpecialEvents facilityId={facilityId} defaultDate={week} onChanged={() => void data.reload()} /> : null}
      {!data.data ? (
        <Skeleton className="h-80" />
      ) : !hours.length ? (
        <EmptyState icon={TrendingUp} title={t('forecast.noHistory')}>{t('forecast.noHistoryHelp')}</EmptyState>
      ) : (
        <>
        {!data.data.forLessons ? <WeekOutlook data={data.data} label={label} view={view} /> : null}
        <Card>
          <CardBody>
            {!data.data.forLessons && data.data.days.some((d) => d.adjustments?.some((a) => a.kind !== 'school')) ? (
              <div className="mb-4">
                <Segmented<View> label={t('forecast.view.label')} value={view} onChange={setView} options={[{ value: 'adjusted', label: t('forecast.view.adjusted') }, { value: 'base', label: t('forecast.view.base') }]} />
              </div>
            ) : null}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-small font-semibold ${gaps ? 'text-danger' : 'text-ok'}`}>{gaps ? t(data.data.forLessons ? 'forecast.gapsLessons' : 'forecast.gaps', { count: gaps }) : t('forecast.covered')}</p>
              {gaps ? (
                toDraft ? (
                  <Button size="sm" loading={drafting} className="h-auto min-h-11 whitespace-normal py-2 text-left sm:min-h-9" icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => void draft()}>{t('forecast.draft', { count: toDraft })}</Button>
                ) : (
                  <Link href="/manage/schedule" className="text-small font-semibold text-brand-text underline-offset-2 hover:underline">{t('forecast.allDrafted')}</Link>
                )
              ) : null}
            </div>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[42rem] border-separate border-spacing-1 text-center text-caption">
                <thead>
                  <tr>
                    <td />
                    {data.data.days.map((d) => (
                      <th key={d.date} className="font-semibold">
                        {label(d.date)}
                        <span className="block font-normal text-muted">{d.schoolDay ? t('forecast.school') : t('forecast.noSchool')}</span>
                        {d.weather ? (
                          <span className="mt-0.5 flex items-center justify-center gap-1 font-normal text-muted">
                            <WeatherIcon condition={d.weather.condition} className="h-3.5 w-3.5" />
                            <span className="sr-only">{t(`forecast.wx.condition.${d.weather.condition}`)}</span>
                            {d.weather.high !== null ? temp(d.weather.high, lng) : d.weather.low !== null ? temp(d.weather.low, lng) : ''}
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.map((hour) => (
                    <tr key={hour}>
                      <th className="pr-2 text-right font-normal text-muted">{hh(hour)}</th>
                      {data.data!.days.map((d) => {
                        const c = d.hours.find((x) => x.hour === hour)!;
                        const v = fig(c, view);
                        const tone = c.open === false ? 'bg-transparent text-muted/60' : !v.needed ? 'bg-surface text-muted' : v.gap ? 'bg-danger-bg text-danger' : 'bg-ok-bg text-ok';
                        return (
                          <td key={d.date} className={`rounded-lg px-1 py-1.5 ${tone}`} title={cellTitle(c)}>
                            <span className="sr-only">{cellTitle(c)}</span>
                            <span aria-hidden="true">
                              {c.open === false ? (
                                t('forecast.closedShort')
                              ) : v.needed ? (
                                <>
                                  <span className="flex items-center justify-center gap-0.5 font-semibold">
                                    {c.scheduled}/{v.needed}
                                    {c.unfilled ? <span className="font-normal opacity-80"> +{c.unfilled}</span> : null}
                                    {changed(c) ? (c.needed > c.base!.needed ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                                  </span>
                                  <span className="flex items-center justify-center gap-0.5 opacity-80">{c.lessons?.classes ? <><GraduationCap className="h-3 w-3" />{c.lessons.swimmers}</> : `~${v.expected}`}</span>
                                </>
                              ) : '·'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-caption text-muted">{t(data.data.forLessons ? 'forecast.legendLessons' : 'forecast.legend', { weeks: data.data.weeksOfHistory })}</p>
            {!data.data.hoursSet && !data.data.forLessons ? <p className="mt-2 text-caption text-muted">{t('forecast.noHoursHint')}</p> : null}
            {view === 'adjusted' && !data.data.forLessons ? <p className="mt-2 text-caption text-muted">{t('forecast.draftAdjusted')}</p> : null}
          </CardBody>
        </Card>
        </>
      )}
      {data.data?.weather ? <p className="text-caption text-muted">{t('forecast.wx.attribution')}{data.data.weather.siteName ? ` · ${t('forecast.wx.site', { name: fr ? data.data.weather.siteName.fr : data.data.weather.siteName.en })}` : ''}</p> : null}
    </div>
  );
}

/**
 * The week at a glance: each day's weather, events and holidays, the reasons the forecast moved,
 * and the most staff needed at once, with and without the adjustments.
 */
function WeekOutlook({ data, label, view }: { data: Forecast; label: (iso: string) => string; view: View }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const w = data.weather;
  const updated = w?.fetchedAt ? dateFormat(lng, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(w.fetchedAt)) : null;
  const status =
    !w ? null :
    w.status === 'unavailable' ? t('forecast.wx.unavailable') :
    w.status === 'no-location' ? t('forecast.wx.noLocation') :
    w.status === 'beyond' ? t('forecast.wx.beyond') :
    w.stale && updated ? t('forecast.wx.stale', { time: updated }) : null;
  const peak = (d: Day, v: View) => Math.max(0, ...d.hours.map((h) => fig(h, v).needed));
  const peakPeople = (d: Day, v: View) => Math.max(0, ...d.hours.map((h) => fig(h, v).expected));
  return (
    <Card>
      <CardBody>
        <h2 className="text-body-strong">{t('forecast.outlook.title')}</h2>
        {status ? (
          <p className="mt-2 flex items-start gap-2 text-small text-muted" role="status">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {status}
          </p>
        ) : null}
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.days.map((d) => {
            const adj = d.adjustments ?? [];
            const moved = adj.filter((a) => a.kind !== 'school');
            const after = peak(d, 'adjusted');
            const before = peak(d, 'base');
            return (
              <li key={d.date} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-small font-semibold">{label(d.date)}</span>
                  {d.weather ? (
                    <span className="flex items-center gap-1 text-small text-muted">
                      <WeatherIcon condition={d.weather.condition} />
                      <span className="sr-only">{t(`forecast.wx.condition.${d.weather.condition}`)}</span>
                      {d.weather.high !== null ? temp(d.weather.high, lng) : ''}
                      {d.weather.low !== null ? <span className="opacity-80"> / {temp(d.weather.low, lng)}</span> : null}
                    </span>
                  ) : null}
                </div>
                {adj.some((a) => a.kind !== 'weather') ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {adj.map((a, i) =>
                      a.kind === 'event' ? <StatusPill key={i} tone="brand">{a.name}</StatusPill> :
                      a.kind === 'holiday' ? <StatusPill key={i} tone="new">{lng.startsWith('fr') && a.nameFr ? a.nameFr : a.name}</StatusPill> :
                      a.kind === 'school' ? <StatusPill key={i} tone="neutral">{t('forecast.events.school', { name: a.name })}</StatusPill> : null,
                    )}
                  </div>
                ) : null}
                {moved.length ? (
                  <ul className="mt-2 grid gap-0.5 text-caption text-muted">
                    {moved.map((a, i) => <li key={i}>{reasonText(a, t, lng)}</li>)}
                  </ul>
                ) : null}
                {after || before ? (
                  <p className="mt-2 text-caption">
                    <span className="font-semibold">{peakPeople(d, view) ? t('forecast.outlook.peak', { count: view === 'base' ? before : after, people: peakPeople(d, view) }) : t('forecast.outlook.peakOnly', { count: view === 'base' ? before : after })}</span>
                    {view === 'adjusted' && before !== after ? <span className="text-muted"> · {t('forecast.outlook.without', { count: before })}</span> : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
