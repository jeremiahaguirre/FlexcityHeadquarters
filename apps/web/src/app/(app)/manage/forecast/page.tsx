'use client';

import { CalendarPlus, ChevronLeft, ChevronRight, GraduationCap, TrendingUp } from 'lucide-react';
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

type Reason = 'bathers' | 'minimum' | 'lessons' | 'closed';
interface Hour { hour: number; open?: boolean | null; unfilled?: number; expected: number; needed: number; scheduled: number; gap: number; basedOnDays: number; lessons?: { classes: number; swimmers: number }; reasons?: Reason[] }
interface Forecast {
  weekStart: string;
  weeksOfHistory: number;
  hoursSet: boolean;
  forLessons: boolean;
  days: Array<{ date: string; schoolDay: boolean; hours: Hour[] }>;
}

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
  useEffect(() => {
    if (!facilityId && facilities.data?.[0]) setFacilityId(facilities.data[0].id);
    if (!positionId && positions.data?.length) setPositionId((positions.data.find((p) => /guard|sauvet/i.test(p.name)) ?? positions.data[0]!).id);
  }, [facilities.data, positions.data, facilityId, positionId]);
  const data = useQuery<Forecast>(facilityId && positionId ? `/api/forecast?facilityId=${facilityId}&weekStart=${week}&positionId=${positionId}` : null);
  const hours = data.data?.days[0]?.hours.map((h) => h.hour) ?? [];
  const label = (iso: string) => dateFormat(lng, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  const hh = (h: number) => dateFormat(lng, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, h)));
  const gaps = data.data?.days.flatMap((d) => d.hours).reduce((s, h) => s + h.gap, 0) ?? 0;
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
  const cellTitle = (c: Hour) =>
    c.open === false
      ? t('forecast.closedTitle')
      : [
          t(data.data?.forLessons ? 'forecast.cellTitleLessons' : 'forecast.cellTitle', { expected: c.expected, needed: c.needed, scheduled: c.scheduled, days: c.basedOnDays }),
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
      {!data.data ? (
        <Skeleton className="h-80" />
      ) : !hours.length ? (
        <EmptyState icon={TrendingUp} title={t('forecast.noHistory')}>{t('forecast.noHistoryHelp')}</EmptyState>
      ) : (
        <Card>
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-small font-semibold ${gaps ? 'text-danger' : 'text-ok'}`}>{gaps ? t(data.data.forLessons ? 'forecast.gapsLessons' : 'forecast.gaps', { count: gaps }) : t('forecast.covered')}</p>
              {gaps ? (
                toDraft ? (
                  <Button size="sm" loading={drafting} icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => void draft()}>{t('forecast.draft', { count: toDraft })}</Button>
                ) : (
                  <Link href="/manage/schedule" className="text-small font-semibold text-brand-text underline-offset-2 hover:underline">{t('forecast.allDrafted')}</Link>
                )
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-separate border-spacing-1 text-center text-caption">
                <thead>
                  <tr>
                    <th />
                    {data.data.days.map((d) => (
                      <th key={d.date} className="font-semibold">{label(d.date)}<span className="block font-normal text-muted">{d.schoolDay ? t('forecast.school') : t('forecast.noSchool')}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.map((hour) => (
                    <tr key={hour}>
                      <th className="pr-2 text-right font-normal text-muted">{hh(hour)}</th>
                      {data.data!.days.map((d) => {
                        const c = d.hours.find((x) => x.hour === hour)!;
                        const tone = c.open === false ? 'bg-transparent text-muted/60' : !c.needed ? 'bg-surface text-muted' : c.gap ? 'bg-danger-bg text-danger' : 'bg-ok-bg text-ok';
                        return (
                          <td key={d.date} className={`rounded-lg px-1 py-1.5 ${tone}`} title={cellTitle(c)}>
                            <span className="sr-only">{cellTitle(c)}</span>
                            <span aria-hidden="true">
                              {c.open === false ? (
                                t('forecast.closedShort')
                              ) : c.needed ? (
                                <>
                                  <span className="block font-semibold">{c.scheduled}/{c.needed}{c.unfilled ? <span className="font-normal opacity-80"> +{c.unfilled}</span> : null}</span>
                                  <span className="flex items-center justify-center gap-0.5 opacity-80">{c.lessons?.classes ? <><GraduationCap className="h-3 w-3" />{c.lessons.swimmers}</> : `~${c.expected}`}</span>
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
          </CardBody>
        </Card>
      )}
    </div>
  );
}
