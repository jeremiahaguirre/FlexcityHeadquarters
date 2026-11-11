/**
 * The only place times, dates, hours and money are formatted (FH Typography doc).
 * Times are shown in the FACILITY's wall-clock time: callers pass the
 * facility-local ISO string the API returns (e.g. "2026-11-14T06:30:00.000-07:00"),
 * and we format its wall-clock part without converting time zones.
 */
type Locale = 'en-CA' | 'fr-CA' | string;

function wallClock(localIso: string): Date {
  const wall = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?/.exec(localIso);
  if (!wall) throw new Error(`Not a local ISO timestamp: ${localIso}`);
  return new Date(`${wall[1]}T${wall[2] ?? '00:00'}:${wall[3] ?? '00'}Z`);
}

export type TimeFormat = 'auto' | '12h' | '24h';
let clock: TimeFormat = 'auto';

/** The city's choice of 12-hour or 24-hour times; "auto" follows the language. */
export function setTimeFormat(f: string | null | undefined): void {
  clock = f === '12h' || f === '24h' ? f : 'auto';
}

/** Adds the city's 12/24-hour choice to any options that show a time of day. */
export function withClock(opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  if (clock === 'auto' || (opts.hour === undefined && opts.timeStyle === undefined)) return opts;
  return { ...opts, hourCycle: clock === '12h' ? 'h12' : 'h23' };
}

/** Use instead of `new Intl.DateTimeFormat` so times follow the city's setting. */
export function dateFormat(locale: Locale, opts?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, withClock(opts));
}

const fmt = (locale: Locale, opts: Intl.DateTimeFormatOptions) => dateFormat(locale, { ...opts, timeZone: 'UTC' });

/** Keep "6 h 30" / "6:30 a.m." on one line. */
const glue = (s: string) => s.replace(/ /g, '\u00a0');

/** "6:30 a.m." · "6 h 30" */
export function formatTime(localIso: string, locale: Locale): string {
  return glue(fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(wallClock(localIso)));
}

/** "6:00 a.m.–2:00 p.m." · "6 h – 14 h" */
export function formatTimeRange(startIso: string, endIso: string, locale: Locale): string {
  const f = fmt(locale, { hour: 'numeric', minute: '2-digit' });
  if (locale.startsWith('fr')) {
    const short = (iso: string) => glue(f.format(wallClock(iso)).replace(/ h 00$/, ' h'));
    return `${short(startIso)} – ${short(endIso)}`;
  }
  return `${glue(f.format(wallClock(startIso)))}–${glue(f.format(wallClock(endIso)))}`;
}

const DATE_STYLES = {
  short: { weekday: 'short', month: 'short', day: 'numeric' },
  long: { weekday: 'long', month: 'long', day: 'numeric' },
  dated: { year: 'numeric', month: 'short', day: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/**
 * short: "Sat, Nov 14" · "sam. 14 nov."; long: "Saturday, November 14" · "samedi 14 novembre";
 * dated (expiries, records, rates — anything that can be in another year): "Nov 14, 2026" · "14 nov. 2026"
 */
export function formatDate(localIso: string, locale: Locale, style: DateStyle = 'short'): string {
  const out = fmt(locale, DATE_STYLES[style]).format(wallClock(localIso));
  // Short dates never break across lines ("Due Dec 10, / 2026").
  return style === 'long' ? out : glue(out);
}

export type DateStyle = keyof typeof DATE_STYLES;

/**
 * Dates that are moments rather than facility wall-clock times (a Date, or an ISO string ending in Z):
 * shown in the viewer's own time zone, in the same styles as formatDate. A plain "2026-11-01" is a
 * calendar day and is shown as is.
 */
export function formatInstant(value: Date | string, locale: Locale, style: DateStyle = 'dated'): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value, locale, style);
  const d = typeof value === 'string' ? new Date(value) : value;
  const out = dateFormat(locale, DATE_STYLES[style]).format(d);
  return style === 'long' ? out : glue(out);
}

/** Both ends of a punch; the date is repeated when it ends on another day ("Mon, Nov 9, 1:33 p.m. – Tue, Nov 10, 6:01 p.m."). */
export function formatSpan(startIso: string, endIso: string, locale: Locale): string {
  if (localDateKey(startIso) === localDateKey(endIso)) return formatTimeRange(startIso, endIso, locale);
  const at = (iso: string) => `${formatDate(iso, locale)}, ${formatTime(iso, locale)}`;
  return `${at(startIso)} – ${at(endIso)}`;
}

/** A length of time: "45 min", "7 h 30 min", "28 h" (both languages). */
export function formatDuration(hours: number | string, locale: Locale): string {
  const total = Math.round((typeof hours === 'string' ? Number(hours) : hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const n = (x: number) => new Intl.NumberFormat(locale).format(x);
  if (!h) return glue(`${n(m)} min`);
  return glue(m ? `${n(h)} h ${String(m).padStart(locale.startsWith('fr') ? 2 : 1, '0')} min` : `${n(h)} h`);
}

/**
 * How long ago or how late, rounded to what a person reads at a glance: minutes up to 90,
 * then whole hours, then days from 48 h ("35 min", "3 h", "2 days" · "2 jours").
 */
export function formatElapsed(minutes: number, locale: Locale): string {
  const m = Math.max(0, Math.round(minutes));
  if (m <= 90) return glue(`${new Intl.NumberFormat(locale).format(m)} min`);
  if (m < 48 * 60) return glue(`${new Intl.NumberFormat(locale).format(Math.floor(m / 60))} h`);
  return glue(new Intl.NumberFormat(locale, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(Math.floor(m / 1440)));
}

/** schedule: "7.5 h" · "7,5 h"; payroll: "7.50 h" · "7,50 h" */
export function formatHours(hours: number | string, locale: Locale, style: 'schedule' | 'payroll' = 'schedule'): string {
  const n = typeof hours === 'string' ? Number(hours) : hours;
  const opts = style === 'payroll' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 };
  return `${new Intl.NumberFormat(locale, opts).format(n)} h`;
}

/** "$22.50" · "22,50 $" */
export function formatMoney(amount: number | string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(typeof amount === 'string' ? Number(amount) : amount);
}

/** "1,250" · "1 250" */
export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** Facility-local ISO for "now"-relative labels; "Today" etc. are handled by callers via i18n. */
export function localDateKey(localIso: string): string {
  return localIso.slice(0, 10);
}
