/**
 * Replays API responses recorded from a real local stack (scripts/capture-demo.cjs)
 * for the static demo. Dates move with the calendar so "today" stays today.
 */

import { DEMO_LOGO } from './demoLogo';

export type DemoRole = 'guard' | 'supervisor' | 'hr' | 'frontdesk' | 'steward' | 'waterworks';
interface Capture { capturedOn: string; responses: Record<string, unknown> }

const loaders: Record<DemoRole | 'public' | 'platform', () => Promise<{ default: Capture }>> = {
  guard: () => import('./demo-fixtures/guard.json') as Promise<{ default: Capture }>,
  supervisor: () => import('./demo-fixtures/supervisor.json') as Promise<{ default: Capture }>,
  hr: () => import('./demo-fixtures/hr.json') as Promise<{ default: Capture }>,
  frontdesk: () => import('./demo-fixtures/frontdesk.json') as Promise<{ default: Capture }>,
  steward: () => import('./demo-fixtures/steward.json') as Promise<{ default: Capture }>,
  waterworks: () => import('./demo-fixtures/waterworks.json') as Promise<{ default: Capture }>,
  public: () => import('./demo-fixtures/public.json') as Promise<{ default: Capture }>,
  platform: () => import('./demo-fixtures/platform.json') as Promise<{ default: Capture }>,
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** A year (2026) or a month (2026-11) in a query, e.g. ?year= or ?month=. */
const YEAR_OR_MONTH = /^\d{4}(-\d{2})?$/;

/**
 * Query values that are dates, months or years aren't part of the lookup key: the demo's sample
 * data is recorded once and has to keep answering as the calendar moves on (next month's
 * remittance, next year's T4s).
 */
export function lookupKey(url: string): string {
  const u = new URL(url, 'http://demo');
  const params = [...u.searchParams.entries()].filter(([, v]) => !DATE.test(v) && !YEAR_OR_MONTH.test(v)).sort(([a], [b]) => a.localeCompare(b));
  return params.length ? `${u.pathname}?${new URLSearchParams(params)}` : u.pathname;
}

export function shiftDate(value: string, days: number): string {
  const m = DATE.exec(value);
  if (!m || days === 0) return value;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10) + (m[4] ?? '');
}

export function shiftDates<T>(value: T, days: number): T {
  if (value === '__DEMO_LOGO__') return DEMO_LOGO as T;
  if (typeof value === 'string') return shiftDate(value, days) as T;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)])) as T;
  return value;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/** Same item captured by several screens (e.g. today and this week) appears once. */
function merge(a: unknown, b: unknown): unknown {
  if (!Array.isArray(a) || !Array.isArray(b)) return b;
  const seen = new Map<string, unknown>();
  for (const x of [...a, ...b]) seen.set((x as { id?: string })?.id ?? JSON.stringify(x), x);
  return [...seen.values()];
}

export interface Fixtures { get(url: string): unknown }

export async function loadFixtures(role: DemoRole | 'public' | 'platform', today = localToday()): Promise<Fixtures> {
  const { default: capture } = await loaders[role]();
  const days = dayNumber(today) - dayNumber(capture.capturedOn);
  const exact = new Map<string, unknown>();
  const byShape = new Map<string, unknown>();
  for (const [url, body] of Object.entries(capture.responses)) {
    const key = lookupKey(url);
    exact.set(key, merge(exact.get(key), shiftDates(body, days)));
    byShape.set(key.replace(UUID, ':id'), exact.get(key));
  }
  return {
    get(url) {
      const find = (k: string) => (exact.has(k) ? exact.get(k) : byShape.get(k.replace(UUID, ':id')));
      let found = find(lookupKey(url));
      // Recorded in one language only (?lang=en-CA): answer the other language with it, since
      // the screens translate their own labels. Without this a French page waits forever.
      if (found === undefined && /[?&]lang=/.test(url)) found = find(lookupKey(url.replace(/([?&]lang=)[^&]*/, '$1en-CA')));
      if (found === undefined) return undefined;
      return within(found, new URL(url, 'http://demo').searchParams);
    },
  };
}

const TIME_FIELDS = ['localStartsAt', 'startsAt', 'localClockIn', 'clockIn', 'localRecordedAt', 'recordedAt', 'localOccurredAt', 'occurredAt'];

/** Keeps list items inside the requested from/to range, as the API would. */
export function within(body: unknown, params: URLSearchParams): unknown {
  const from = params.get('from');
  const to = params.get('to');
  if (!Array.isArray(body) || !from || !to) return body;
  const start = Date.parse(from);
  const end = Date.parse(to);
  return body.filter((item) => {
    const src = (item as { shift?: object })?.shift ?? item;
    const field = TIME_FIELDS.find((f) => typeof (src as Record<string, unknown>)[f] === 'string');
    if (!field) return true;
    const t = Date.parse((src as Record<string, string>)[field]!);
    return t >= start && t < end;
  });
}
