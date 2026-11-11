/**
 * Special events for the demand forecast: what a manager adds (a swim meet, a tournament, Canada
 * Day fireworks), one facility or the whole city, once or every year; and the province's statutory
 * holidays (the payroll holiday table), which feed in by themselves.
 */
import type { Profile } from './weather.js';

export interface EventRow {
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

const shiftYears = (iso: string, years: number) => {
  const y = Number(iso.slice(0, 4)) + years;
  const md = iso.slice(5);
  // 29 February in a year without one: the 28th.
  if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return `${y}-02-28`;
  return `${y}-${md}`;
};

/** Whether an event is on a date; a yearly one on the same dates any year from its first. */
export function occursOn(e: Pick<EventRow, 'startsOn' | 'endsOn' | 'recursYearly'>, date: string): boolean {
  if (date >= e.startsOn && date <= e.endsOn) return true;
  if (!e.recursYearly || date < e.startsOn) return false;
  const years = Number(date.slice(0, 4)) - Number(e.startsOn.slice(0, 4));
  // This year's occurrence, or last year's when it spans New Year.
  return [years, years - 1].some((k) => k > 0 && date >= shiftYears(e.startsOn, k) && date <= shiftYears(e.endsOn, k));
}

/** Whether an event covers [hour, hour+1); an all-day event covers every hour. */
export function coversHour(e: Pick<EventRow, 'startMinute' | 'endMinute'>, hour: number): boolean {
  if (e.startMinute === null || e.endMinute === null) return true;
  return e.startMinute < (hour + 1) * 60 && e.endMinute > hour * 60;
}

/** Rule of thumb for a statutory holiday: more people off work and school. */
export function holidayEffect(profile: Profile): number {
  return profile === 'outdoor' ? 15 : profile === 'arena' ? 5 : profile === 'mixed' ? 12 : 10;
}
