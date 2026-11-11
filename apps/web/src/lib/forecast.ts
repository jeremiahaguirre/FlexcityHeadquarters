/** Demand forecast: the shapes the API returns and the short reasons shown for each day. */
import type { TFunction } from 'i18next';

export type Condition = 'sunny' | 'partly' | 'cloudy' | 'showers' | 'rain' | 'thunder' | 'snow' | 'mixed' | 'fog';
export type Bucket = 'thunder' | 'rain' | 'snow' | 'hot' | 'warm' | 'mild' | 'cold';

export type Adjustment =
  | { kind: 'weather'; bucket: Bucket; condition: Condition; high: number | null; pct: number; source: 'learned' | 'default'; days?: number }
  | { kind: 'holiday'; name: string; nameFr: string | null; pct: number }
  | { kind: 'event'; id: string; name: string; pct: number | null; extra: number | null; startMinute: number | null; endMinute: number | null; cityWide: boolean; notes: string | null }
  | { kind: 'school'; name: string };

export interface DayWeather {
  high: number | null;
  low: number | null;
  pop: number | null;
  iconCode: number | null;
  condition: Condition;
  summaryEn: string | null;
  summaryFr: string | null;
  observed: boolean;
}

export interface WeatherInfo {
  status: 'ok' | 'unavailable' | 'no-location' | 'beyond';
  site: string | null;
  siteName: { en: string; fr: string } | null;
  fetchedAt: string | null;
  stale: boolean;
  profile: 'outdoor' | 'indoor' | 'arena' | 'mixed';
  learned: Array<{ bucket: Bucket; pct: number; days: number }>;
}

export const pct = (n: number, lng: string) => new Intl.NumberFormat(lng, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 0 }).format(n / 100);
export const temp = (n: number, lng: string) => new Intl.NumberFormat(lng, { style: 'unit', unit: 'celsius', maximumFractionDigits: 0 }).format(n);
const clock = (m: number, lng: string) => new Intl.DateTimeFormat(lng, { hour: 'numeric', minute: m % 60 ? '2-digit' : undefined, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, Math.floor(m / 60), m % 60)));

/** What the weather is, in a few words: "hot and sunny (31°C)". */
export function weatherWords(a: Extract<Adjustment, { kind: 'weather' }>, t: TFunction, lng: string): string {
  const sunny = a.condition === 'sunny' || a.condition === 'partly';
  const key =
    a.bucket === 'hot' ? (sunny ? 'hotSunny' : 'hot') :
    a.bucket === 'warm' ? (a.condition === 'sunny' ? 'warmSunny' : 'warm') :
    a.bucket === 'rain' ? (a.condition === 'showers' ? 'showers' : 'rain') :
    a.bucket;
  const words = t(`forecast.wx.${key}`);
  return a.high === null || a.bucket === 'rain' || a.bucket === 'thunder' || a.bucket === 'snow' ? words : `${words} (${temp(a.high, lng)})`;
}

/** One line per adjustment: "+18% hot and sunny (31°C)", "+40 people · Swim meet (1 p.m.–3 p.m.)". */
export function reasonText(a: Adjustment, t: TFunction, lng: string): string {
  const fr = lng.startsWith('fr');
  switch (a.kind) {
    case 'weather': {
      const learned = a.source === 'learned' ? ` ${t('forecast.wx.learned', { count: a.days ?? 0 })}` : '';
      return a.pct ? `${pct(a.pct, lng)} ${weatherWords(a, t, lng)}${learned}` : `${t('forecast.wx.noEffect', { what: weatherWords(a, t, lng) })}${learned}`;
    }
    case 'holiday':
      return `${pct(a.pct, lng)} ${t('forecast.events.holiday', { name: fr && a.nameFr ? a.nameFr : a.name })}`;
    case 'event': {
      const parts = [a.pct ? pct(a.pct, lng) : '', a.extra ? t('forecast.events.extra', { count: a.extra }) : ''].filter(Boolean).join(' ');
      const when = a.startMinute !== null && a.endMinute !== null ? ` (${clock(a.startMinute, lng)}–${clock(a.endMinute, lng)})` : '';
      return `${parts} ${a.name}${when}`.trim();
    }
    case 'school':
      return t('forecast.events.school', { name: a.name });
  }
}

/** A special event's effect: extra people, a percentage, or both. */
export type EventEffect = 'extra' | 'percent' | 'both';
export const eventEffect = (e: { extraPeople: number | null; percent: number | null } | 'new'): EventEffect =>
  e === 'new' ? 'extra' : e.extraPeople !== null && e.percent !== null ? 'both' : e.percent !== null ? 'percent' : 'extra';
/** What the events dialog saves for the chosen effect: the fields it doesn't use are cleared. */
export const eventEffectValues = (effect: EventEffect, extraPeople: number | null, percent: number | null) => ({
  extraPeople: effect === 'percent' ? null : extraPeople,
  percent: effect === 'extra' ? null : percent,
});
