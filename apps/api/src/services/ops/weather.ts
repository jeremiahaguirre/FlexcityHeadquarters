/**
 * Weather for the demand forecast, from Environment and Climate Change Canada's open data
 * (MSC GeoMet OGC API at api.weather.gc.ca, no key; "Data: Environment and Climate Change Canada").
 *
 * - City page forecasts (collection `citypageweather-realtime`): about six days ahead per forecast
 *   site ("bc-48"). The worker fetches each distinct site every few hours, whatever number of
 *   facilities or organizations use it, into WeatherForecastDay (shared, kept a week). Only the
 *   site code (or, to find the nearest site, a facility's rounded coordinates) is ever sent.
 * - Daily climate data (collections `climate-stations`, `climate-daily`): what the weather was, for
 *   learning how attendance responded. Until a station's data comes in, the day's own forecast is
 *   kept as the observation.
 *
 * Every fetch has a timeout and a few retries; a failure is recorded on the site and the forecast
 * carries on without weather. Parsing is tolerant: values may come as plain numbers/strings or as
 * { en, fr } pairs, single objects or arrays.
 */
import type { PrismaClient } from '../../generated/prisma/client.js';
import { config } from '../../config.js';
import { db, tenantIds, withTenant } from '../../lib/db.js';
import { publicGet } from '../../lib/egress.js';
import { weatherFetches } from '../../lib/metrics.js';
import { addDays, dayOfWeek, localDate } from '../../lib/time.js';

export type Condition = 'sunny' | 'partly' | 'cloudy' | 'showers' | 'rain' | 'thunder' | 'snow' | 'mixed' | 'fog';
export const CONDITIONS: Condition[] = ['sunny', 'partly', 'cloudy', 'showers', 'rain', 'thunder', 'snow', 'mixed', 'fog'];

export interface DayForecast {
  date: string;
  high: number | null;
  low: number | null;
  pop: number | null;
  iconCode: number | null;
  condition: Condition;
  summaryEn: string | null;
  summaryFr: string | null;
}

export interface SiteInfo {
  site: string;
  nameEn: string;
  nameFr: string | null;
  latitude: number;
  longitude: number;
}

// ---------------------------------------------------------------------------------------------
// Parsing

type J = unknown;
const obj = (v: J): Record<string, J> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, J>) : null);
const list = (v: J): J[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** A value in one language: plain, { en, fr }, or { value: … }. */
export function text(v: J, lang: 'en' | 'fr' = 'en'): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  const o = obj(v);
  if (!o) return null;
  if (lang in o || 'en' in o || 'fr' in o) return text(o[lang] ?? o.en ?? o.fr, lang);
  if ('value' in o) return text(o.value, lang);
  return null;
}

export function num(v: J): number | null {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** ECCC icon codes (00–48; 30–39 are the night versions) to a condition. */
export function conditionFromIcon(code: number | null): Condition | null {
  if (code === null) return null;
  if ([0, 1, 30, 31].includes(code)) return 'sunny';
  if ([2, 4, 5, 22, 32, 34, 35].includes(code)) return 'partly';
  if ([3, 10, 33, 43].includes(code)) return 'cloudy';
  if ([6, 36].includes(code)) return 'showers';
  if ([11, 12, 13, 28].includes(code)) return 'rain';
  if ([9, 19, 39, 41, 42, 46, 47, 48].includes(code)) return 'thunder';
  if ([8, 16, 17, 18, 25, 26, 38, 40].includes(code)) return 'snow';
  if ([7, 14, 15, 27, 37].includes(code)) return 'mixed';
  if ([23, 24, 44, 45].includes(code)) return 'fog';
  return null;
}

/** From the words, when there's no icon code (English or French summary). */
export function conditionFromText(s: string | null): Condition {
  const x = (s ?? '').toLowerCase();
  if (/thunder|orage/.test(x)) return 'thunder';
  if (/freezing|verglas|mixed|mélange|rain and snow|pluie et neige|hail|grêle/.test(x)) return 'mixed';
  if (/snow|flurr|neige|averses de neige/.test(x)) return 'snow';
  if (/shower|averse/.test(x)) return 'showers';
  if (/rain|drizzle|pluie|bruine/.test(x)) return 'rain';
  if (/fog|haze|smoke|brouillard|brume|fumée/.test(x)) return 'fog';
  if (/mainly cloudy|mostly cloudy|cloudy|overcast|nuageux|couvert/.test(x) && !/a mix of sun|alternance|partly|passages/.test(x)) return 'cloudy';
  if (/sun|clear|ensoleillé|dégagé/.test(x) && !/cloud|nuage/.test(x)) return 'sunny';
  return 'partly';
}

const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PROVINCE_TZ: Record<string, string> = {
  bc: 'America/Vancouver', ab: 'America/Edmonton', sk: 'America/Regina', mb: 'America/Winnipeg', on: 'America/Toronto', qc: 'America/Toronto',
  nb: 'America/Halifax', ns: 'America/Halifax', pe: 'America/Halifax', nl: 'America/St_Johns', yt: 'America/Whitehorse', nt: 'America/Yellowknife', nu: 'America/Iqaluit',
};
export const siteTimezone = (site: string) => PROVINCE_TZ[site.slice(0, 2).toLowerCase()] ?? 'America/Toronto';

/**
 * One city page feature (JSON from /collections/citypageweather-realtime/items/{site}) into days:
 * day periods ("Today", "Thursday") give the high and the day's condition; the night after gives
 * the low. A first period of "Tonight" makes a day with only a low.
 */
export function parseCityPage(feature: J, site: string, now = new Date()): { info: SiteInfo | null; days: DayForecast[] } {
  const f = obj(feature) ?? {};
  const p = obj(f.properties) ?? f;
  const coords = list(obj(f.geometry)?.coordinates).map(Number);
  const info: SiteInfo | null =
    coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])
      ? { site, nameEn: text(p.name, 'en') ?? site, nameFr: text(p.name, 'fr'), latitude: coords[1]!, longitude: coords[0]! }
      : null;
  const group = obj(p.forecastGroup) ?? {};
  const issuedRaw = text(group.timestamp) ?? text(p.lastUpdated) ?? text(list(group.dateTime).map(obj).find((d) => d && text(d.zone) === 'UTC')?.timeStamp);
  const issued = issuedRaw && !Number.isNaN(Date.parse(issuedRaw)) ? new Date(issuedRaw) : now;
  const base = localDate(issued, siteTimezone(site));
  const out = new Map<string, DayForecast>();
  let current: string | null = null;
  let first = true;
  for (const raw of list(group.forecasts ?? group.forecast)) {
    const fc = obj(raw);
    if (!fc) continue;
    const period = obj(fc.period) ?? {};
    const name = (text(period.textForecastName, 'en') ?? text(period.value, 'en') ?? text(fc.period, 'en') ?? '').toLowerCase();
    const weekdayName = (text(period.value, 'en') ?? name).toLowerCase();
    const night = /night|tonight/.test(name) || /night|tonight/.test(weekdayName);
    let date: string;
    if (first) {
      date = base;
      // "Thursday" as the first period after midnight but before the morning issue.
      const wd = WEEKDAYS_EN.findIndex((w) => weekdayName.startsWith(w));
      if (wd >= 0 && !/today|tonight/.test(name)) for (let i = -1; i <= 1; i++) if (dayOfWeek(addDays(base, i)) === wd) date = addDays(base, i);
    } else if (night) {
      date = current ?? base;
    } else {
      const from = current ?? base;
      date = addDays(from, 1);
      const wd = WEEKDAYS_EN.findIndex((w) => weekdayName.startsWith(w));
      if (wd >= 0) {
        for (let i = 1; i <= 7; i++) {
          if (dayOfWeek(addDays(from, i)) === wd) {
            date = addDays(from, i);
            break;
          }
        }
      }
    }
    first = false;
    current = date;
    const abbr = obj(fc.abbreviatedForecast) ?? {};
    const icon = num(obj(abbr.icon)?.value ?? abbr.iconCode ?? abbr.icon);
    const pop = num(obj(abbr.pop)?.value ?? abbr.pop);
    const summaryEn = text(abbr.textSummary, 'en') ?? text(fc.textSummary, 'en');
    const summaryFr = text(abbr.textSummary, 'fr') ?? text(fc.textSummary, 'fr');
    const temps = list(obj(fc.temperatures)?.temperature ?? fc.temperature);
    let high: number | null = null;
    let low: number | null = null;
    for (const tRaw of temps) {
      const t = obj(tRaw);
      if (!t) continue;
      const cls = (text(t.class, 'en') ?? '').toLowerCase();
      const v = num(t.value ?? t);
      if (v === null) continue;
      if (cls === 'high' || cls === 'max') high = Math.round(v);
      else if (cls === 'low' || cls === 'min') low = Math.round(v);
      else if (night) low = Math.round(v);
      else high = Math.round(v);
    }
    const condition = conditionFromIcon(icon) ?? conditionFromText(summaryEn ?? summaryFr);
    const day = out.get(date);
    if (!day) {
      out.set(date, { date, high, low, pop, iconCode: icon, condition, summaryEn, summaryFr });
    } else if (night) {
      // The night after: its low; a storm tonight counts for the day's evening too.
      day.low = low ?? day.low;
      if (day.high === null) Object.assign(day, { pop, iconCode: icon, condition, summaryEn, summaryFr });
      else if (condition === 'thunder' && day.condition !== 'thunder' && (pop ?? 0) >= 60) day.condition = 'thunder';
    }
  }
  return { info, days: [...out.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** City page features around a point (bbox search) → sites. */
export function parseSites(collection: J): SiteInfo[] {
  const out: SiteInfo[] = [];
  for (const raw of list(obj(collection)?.features)) {
    const f = obj(raw);
    if (!f) continue;
    const p = obj(f.properties) ?? {};
    const site = text(p.identifier) ?? text(f.id);
    const c = list(obj(f.geometry)?.coordinates).map(Number);
    if (!site || !/^[a-z]{2}-\d{1,4}$/i.test(site) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    out.push({ site: site.toLowerCase(), nameEn: text(p.name, 'en') ?? site, nameFr: text(p.name, 'fr'), latitude: c[1]!, longitude: c[0]! });
  }
  return out;
}

export interface Observation {
  date: string;
  high: number | null;
  low: number | null;
  precipMm: number | null;
  snowCm: number | null;
  condition: Condition;
}

/** Daily climate items (`climate-daily`) → observations. Without sunshine data, a dry warm day counts as sunny. */
export function parseClimateDaily(collection: J): Observation[] {
  const out: Observation[] = [];
  for (const raw of list(obj(collection)?.features)) {
    const p = obj(obj(raw)?.properties) ?? {};
    const date = (text(p.LOCAL_DATE) ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const high = num(p.MAX_TEMPERATURE);
    const low = num(p.MIN_TEMPERATURE);
    const rain = num(p.TOTAL_RAIN);
    const precipMm = num(p.TOTAL_PRECIPITATION) ?? rain;
    const snowCm = num(p.TOTAL_SNOW);
    if (high === null && precipMm === null) continue;
    const wet = rain ?? precipMm ?? 0;
    const condition: Condition =
      (snowCm ?? 0) >= 1 ? 'snow' : wet >= 5 ? 'rain' : wet >= 1 ? 'showers' : high !== null && high >= 20 ? 'sunny' : 'partly';
    out.push({ date, high, low, precipMm, snowCm, condition });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Climate stations around a point → the nearest one still reporting daily data. */
export function nearestClimateStation(collection: J, lat: number, lng: number, today: string): string | null {
  let best: { id: string; d: number } | null = null;
  for (const raw of list(obj(collection)?.features)) {
    const f = obj(raw);
    const p = obj(f?.properties) ?? {};
    const id = text(p.CLIMATE_IDENTIFIER);
    const c = list(obj(f?.geometry)?.coordinates).map(Number);
    if (!id || c.length < 2) continue;
    const last = (text(p.DLY_LAST_DATE) ?? '').slice(0, 10);
    if (last && last < addDays(today, -60)) continue;
    const d = distanceKm(lat, lng, c[1]!, c[0]!);
    if (!best || d < best.d) best = { id, d };
  }
  return best && best.d <= 60 ? best.id : null;
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------------------------
// The effect of the weather on attendance

export type Bucket = 'thunder' | 'rain' | 'snow' | 'hot' | 'warm' | 'mild' | 'cold';
export type Profile = 'outdoor' | 'indoor' | 'arena' | 'mixed';

export function profileOf(exposure: 'INDOOR' | 'OUTDOOR' | 'MIXED', venueKind: string): Profile {
  if (venueKind === 'ARENA') return 'arena';
  if (venueKind === 'PARK' || venueKind === 'BEACH') return exposure === 'INDOOR' ? 'indoor' : 'outdoor';
  return exposure === 'OUTDOOR' ? 'outdoor' : exposure === 'MIXED' ? 'mixed' : 'indoor';
}

export interface WeatherDay {
  high: number | null;
  condition: Condition;
  pop?: number | null;
  precipMm?: number | null;
  snowCm?: number | null;
}

/** The kind of day, as far as attendance goes. */
export function bucketOf(w: WeatherDay): Bucket {
  if (w.condition === 'thunder' && (w.pop ?? 100) >= 40) return 'thunder';
  if (w.condition === 'snow' || (w.snowCm ?? 0) >= 1) return 'snow';
  const wet = w.condition === 'rain' || w.condition === 'mixed' || (w.condition === 'showers' && (w.pop ?? 60) >= 60) || (w.precipMm ?? 0) >= 5;
  if (wet) return 'rain';
  if (w.high === null) return 'mild';
  if (w.high >= 28) return 'hot';
  if (w.high >= 22) return 'warm';
  if (w.high < 12) return 'cold';
  return 'mild';
}

const summer = (date: string) => {
  const m = Number(date.slice(5, 7));
  return m >= 5 && m <= 9;
};

/**
 * Rule-of-thumb effect (percent) until a facility has enough history of its own:
 * outdoor pools and parks are up on hot sunny days and down with rain, thunder or cold;
 * indoor pools are mildly up on rainy summer days; arenas barely move.
 */
export function defaultEffect(profile: Profile, bucket: Bucket, w: WeatherDay, date: string): number {
  if (profile === 'mixed') return Math.round((defaultEffect('outdoor', bucket, w, date) + defaultEffect('indoor', bucket, w, date)) / 2);
  if (profile === 'arena') return bucket === 'snow' ? -5 : bucket === 'hot' && summer(date) ? 5 : 0;
  if (profile === 'indoor') {
    if ((bucket === 'rain' || bucket === 'thunder') && summer(date)) return 10;
    if (bucket === 'snow') return -10;
    if (bucket === 'hot') return -5;
    return 0;
  }
  switch (bucket) {
    case 'hot': {
      // +3% a degree above 25 °C, sunnier days fully, cloudy ones two-thirds; at most +40%.
      const pct = Math.min(40, Math.max(9, 3 * ((w.high ?? 28) - 25)));
      return w.condition === 'sunny' || w.condition === 'partly' ? pct : Math.round((pct * 2) / 3);
    }
    case 'warm':
      return w.condition === 'sunny' ? 5 : 0;
    case 'rain':
      return -35;
    case 'thunder':
      return -60;
    case 'snow':
      return -40;
    case 'cold':
      return -30;
    default:
      return 0;
  }
}

export const MIN_LEARN_DAYS = 6;

export interface LearnDay {
  date: string;
  total: number;
  weather: WeatherDay;
}

/**
 * How attendance actually moved with the weather at this facility: each day's total against the
 * average of the same weekday (school day or not) within four weeks either side, grouped by kind
 * of day. A kind of day with at least MIN_LEARN_DAYS days replaces the rule of thumb.
 */
export function learnEffects(days: LearnDay[], isSchoolDay: (d: string) => boolean): Map<Bucket, { pct: number; days: number }> {
  const byKey = days.filter((d) => d.total > 0);
  const ratios = new Map<Bucket, number[]>();
  for (const d of byKey) {
    const peers = byKey.filter((o) => o.date !== d.date && dayOfWeek(o.date) === dayOfWeek(d.date) && isSchoolDay(o.date) === isSchoolDay(d.date) && Math.abs(Date.parse(o.date) - Date.parse(d.date)) <= 28 * 86_400_000);
    if (peers.length < 2) continue;
    const base = peers.reduce((s, o) => s + o.total, 0) / peers.length;
    if (base <= 0) continue;
    const b = bucketOf(d.weather);
    ratios.set(b, [...(ratios.get(b) ?? []), d.total / base]);
  }
  const out = new Map<Bucket, { pct: number; days: number }>();
  for (const [b, rs] of ratios) {
    if (rs.length < MIN_LEARN_DAYS) continue;
    const mean = rs.reduce((s, r) => s + r, 0) / rs.length;
    out.set(b, { pct: Math.max(-70, Math.min(80, Math.round((mean - 1) * 100))), days: rs.length });
  }
  return out;
}

export interface WeatherEffect {
  bucket: Bucket;
  pct: number;
  source: 'learned' | 'default';
  days?: number;
}

/** The effect for one day: learned at this facility when there's enough history, else the rule of thumb. */
export function weatherEffect(profile: Profile, w: WeatherDay, date: string, learned: Map<Bucket, { pct: number; days: number }>): WeatherEffect {
  const bucket = bucketOf(w);
  const l = learned.get(bucket);
  // Mild days are the baseline: learning them only measures noise.
  if (l && bucket !== 'mild') return { bucket, pct: l.pct, source: 'learned', days: l.days };
  return { bucket, pct: defaultEffect(profile, bucket, w, date), source: 'default' };
}

// ---------------------------------------------------------------------------------------------
// Fetching (through lib/egress.ts), with timeouts and retries

export type Getter = (url: string) => Promise<{ status: number; body: string }>;
const defaultGet: Getter = (url) => publicGet(url, 'Environment Canada weather', { timeoutMs: config().WEATHER_TIMEOUT_MS, maxBytes: 5_000_000, allowLocal: config().NODE_ENV !== 'production' });

export interface WeatherSource {
  sitesNear(lat: number, lng: number): Promise<SiteInfo[]>;
  cityPage(site: string): Promise<{ info: SiteInfo | null; days: DayForecast[] }>;
  climateStation(lat: number, lng: number, today: string): Promise<string | null>;
  climateDaily(climateId: string, from: string, to: string): Promise<Observation[]>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ECCC's OGC API. `retries` extra tries on a network error, a timeout or a 5xx/429, with backoff. */
export function ecccSource(opts: { get?: Getter; base?: string; retries?: number; backoffMs?: number[] } = {}): WeatherSource {
  const get = opts.get ?? defaultGet;
  const base = (opts.base ?? config().ECCC_API_BASE).replace(/\/$/, '');
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? [1_000, 4_000];
  async function json(kind: string, path: string): Promise<J> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
      try {
        const r = await get(`${base}${path}`);
        if (r.status === 404) {
          weatherFetches.inc({ kind, outcome: 'not_found' });
          throw Object.assign(new Error(`Not found: ${path.split('?')[0]}`), { final: true });
        }
        if (r.status === 429 || r.status >= 500) throw new Error(`Answered ${r.status}`);
        if (r.status !== 200) throw Object.assign(new Error(`Answered ${r.status}`), { final: true });
        const parsed = JSON.parse(r.body) as J;
        weatherFetches.inc({ kind, outcome: 'ok' });
        return parsed;
      } catch (err) {
        lastErr = err;
        if ((err as { final?: boolean }).final) break;
        weatherFetches.inc({ kind, outcome: 'retry' });
      }
    }
    weatherFetches.inc({ kind, outcome: 'failed' });
    throw lastErr instanceof Error ? lastErr : new Error('Weather request failed');
  }
  const bbox = (lat: number, lng: number, d: number) => [lng - d, lat - d, lng + d, lat + d].map((x) => x.toFixed(2)).join(',');
  return {
    async sitesNear(lat, lng) {
      return parseSites(await json('sites', `/collections/citypageweather-realtime/items?f=json&limit=50&bbox=${bbox(lat, lng, 0.6)}`));
    },
    async cityPage(site) {
      return parseCityPage(await json('forecast', `/collections/citypageweather-realtime/items/${encodeURIComponent(site)}?f=json`), site);
    },
    async climateStation(lat, lng, today) {
      return nearestClimateStation(await json('stations', `/collections/climate-stations/items?f=json&limit=100&bbox=${bbox(lat, lng, 0.5)}`), lat, lng, today);
    },
    async climateDaily(climateId, from, to) {
      return parseClimateDaily(await json('climate', `/collections/climate-daily/items?f=json&limit=400&CLIMATE_IDENTIFIER=${encodeURIComponent(climateId)}&datetime=${from}/${to}&sortby=LOCAL_DATE`));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The worker job

/** Forecast days are kept a week after the day; observations three years (learning uses one). */
export const FORECAST_KEEP_DAYS = 7;
export const OBSERVATION_KEEP_DAYS = 3 * 365;

const round = (x: number) => Math.round(x * 10) / 10;

/** The nearest known site within 75 km, from the sites already stored. */
async function nearestStoredSite(prisma: PrismaClient, lat: number, lng: number): Promise<string | null> {
  const near = await prisma.weatherSite.findMany({ where: { latitude: { gte: lat - 0.7, lte: lat + 0.7 }, longitude: { gte: lng - 1, lte: lng + 1 } } });
  let best: { site: string; d: number } | null = null;
  for (const s of near) {
    const d = distanceKm(lat, lng, s.latitude, s.longitude);
    if (!best || d < best.d) best = { site: s.site, d };
  }
  return best && best.d <= 75 ? best.site : null;
}

export interface RefreshResult {
  sites: number;
  fetched: number;
  failed: number;
  located: number;
  observations: number;
  removed: number;
}

/**
 * Every few hours: for each distinct forecast site in use (by any organization), fetch the city
 * page forecast when it's older than WEATHER_REFRESH_HOURS; record observed weather; drop old rows.
 * Never throws for a weather failure: it's recorded on the site and the forecast carries on.
 */
/** `tenants` limits the run to some organizations (tests, a one-off run); default every one. */
export async function refreshWeather(opts: { source?: WeatherSource; prisma?: PrismaClient; now?: Date; force?: boolean; tenants?: string[] } = {}): Promise<RefreshResult> {
  const prisma = opts.prisma ?? db();
  const source = opts.source ?? ecccSource();
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const result: RefreshResult = { sites: 0, fetched: 0, failed: 0, located: 0, observations: 0, removed: 0 };
  if (config().WEATHER === 'off' && !opts.source) return result;

  // 1. Each organization's facilities: their site, or find the nearest one from the coordinates.
  //    Coordinates are rounded (about 10 km) before being sent, and each rounded point asked once.
  const sites = new Set<string>();
  const lookups = new Map<string, Promise<string | null>>();
  const locate = (lat: number, lng: number) => {
    const key = `${round(lat)},${round(lng)}`;
    if (!lookups.has(key)) {
      lookups.set(key, (async () => {
        const stored = await nearestStoredSite(prisma, lat, lng);
        if (stored) return stored;
        try {
          const found = await source.sitesNear(round(lat), round(lng));
          for (const s of found) await prisma.weatherSite.upsert({ where: { site: s.site }, create: s, update: { nameEn: s.nameEn, nameFr: s.nameFr, latitude: s.latitude, longitude: s.longitude } });
          return nearestStoredSite(prisma, lat, lng);
        } catch {
          return null;
        }
      })());
    }
    return lookups.get(key)!;
  };
  for (const tenantId of opts.tenants ?? (await tenantIds(prisma))) {
    await withTenant(tenantId, async (tx) => {
      const facilities = await tx.facility.findMany({ select: { id: true, latitude: true, longitude: true, weatherSite: true, weatherSiteAuto: true } });
      for (const f of facilities) {
        if (f.weatherSite) sites.add(f.weatherSite);
        else if (f.latitude !== null && f.longitude !== null) {
          const s = f.weatherSiteAuto ?? (await locate(f.latitude.toNumber(), f.longitude.toNumber()));
          if (s && s !== f.weatherSiteAuto) {
            await tx.facility.update({ where: { id: f.id }, data: { weatherSiteAuto: s } });
            result.located++;
          }
          if (s) sites.add(s);
        }
      }
      return 0;
    }, { prisma });
  }
  result.sites = sites.size;

  // 2. One fetch per site, shared by everyone near it.
  const staleBefore = new Date(now.getTime() - config().WEATHER_REFRESH_HOURS * 3_600_000 + 60_000);
  for (const site of sites) {
    const known = await prisma.weatherSite.findUnique({ where: { site } });
    if (!opts.force && known?.lastOkAt && known.lastOkAt > staleBefore) continue;
    // After repeated failures, wait longer between tries (up to a day).
    if (!opts.force && known?.failures && known.lastFetchAt && now.getTime() - known.lastFetchAt.getTime() < Math.min(24, 2 ** Math.min(known.failures, 5)) * 3_600_000 / 4) continue;
    try {
      const { info, days } = await source.cityPage(site);
      if (!days.length) throw new Error('No forecast in the answer');
      await prisma.$transaction(async (tx) => {
        await tx.weatherSite.upsert({
          where: { site },
          create: { site, nameEn: info?.nameEn ?? site, nameFr: info?.nameFr ?? null, latitude: info?.latitude ?? 0, longitude: info?.longitude ?? 0, lastFetchAt: now, lastOkAt: now, failures: 0 },
          update: { ...(info ? { nameEn: info.nameEn, nameFr: info.nameFr, latitude: info.latitude, longitude: info.longitude } : {}), lastFetchAt: now, lastOkAt: now, failures: 0, lastError: null },
        });
        for (const d of days) {
          const data = { high: d.high, low: d.low, pop: d.pop, iconCode: d.iconCode, condition: d.condition, summaryEn: d.summaryEn?.slice(0, 200) ?? null, summaryFr: d.summaryFr?.slice(0, 200) ?? null, fetchedAt: now };
          await tx.weatherForecastDay.upsert({ where: { site_date: { site, date: new Date(`${d.date}T00:00:00Z`) } }, create: { site, date: new Date(`${d.date}T00:00:00Z`), ...data }, update: data });
        }
        // Today as forecast this morning stands in for the observation until climate data comes in.
        const todayFc = days.find((d) => d.date === localDate(now, siteTimezone(site)));
        if (todayFc && todayFc.high !== null) {
          const key = { site_date: { site, date: new Date(`${todayFc.date}T00:00:00Z`) } };
          const existing = await tx.weatherObservation.findUnique({ where: key });
          if (!existing || existing.source === 'forecast') {
            const obs = { high: todayFc.high, low: todayFc.low, precipMm: null, snowCm: null, condition: todayFc.condition, source: 'forecast' };
            await tx.weatherObservation.upsert({ where: key, create: { site, date: new Date(`${todayFc.date}T00:00:00Z`), ...obs }, update: obs });
          }
        }
      });
      result.fetched++;
    } catch (err) {
      result.failed++;
      const message = (err instanceof Error ? err.message : 'Weather request failed').slice(0, 300);
      await prisma.weatherSite.upsert({
        where: { site },
        create: { site, nameEn: site, latitude: 0, longitude: 0, lastFetchAt: now, failures: 1, lastError: message },
        update: { lastFetchAt: now, failures: { increment: 1 }, lastError: message },
      });
      continue;
    }

    // 3. Observed weather from the nearest climate station: a year at first, then the last ten days.
    try {
      const s = await prisma.weatherSite.findUniqueOrThrow({ where: { site } });
      let climateId = s.climateId;
      if (!climateId && (s.latitude || s.longitude)) {
        climateId = await source.climateStation(s.latitude, s.longitude, today);
        if (climateId) await prisma.weatherSite.update({ where: { site }, data: { climateId } });
      }
      if (climateId) {
        const have = await prisma.weatherObservation.count({ where: { site, source: 'climate' } });
        const from = addDays(today, have >= 30 ? -10 : -365);
        const obs = await source.climateDaily(climateId, from, addDays(today, -1));
        for (const o of obs) {
          const data = { high: o.high, low: o.low, precipMm: o.precipMm, snowCm: o.snowCm, condition: o.condition, source: 'climate' };
          await prisma.weatherObservation.upsert({ where: { site_date: { site, date: new Date(`${o.date}T00:00:00Z`) } }, create: { site, date: new Date(`${o.date}T00:00:00Z`), ...data }, update: data });
        }
        result.observations += obs.length;
      }
    } catch {
      // Observed weather is a nice-to-have: the day's forecast stands in for it.
    }
  }

  // 4. Short retention for the forecast cache.
  const a = await prisma.weatherForecastDay.deleteMany({ where: { date: { lt: new Date(`${addDays(today, -FORECAST_KEEP_DAYS)}T00:00:00Z`) } } });
  const b = await prisma.weatherObservation.deleteMany({ where: { date: { lt: new Date(`${addDays(today, -OBSERVATION_KEEP_DAYS)}T00:00:00Z`) } } });
  result.removed = a.count + b.count;
  return result;
}
