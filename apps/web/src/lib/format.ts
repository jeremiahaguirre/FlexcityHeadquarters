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
export function formatDate(localIso: string, locale: Locale, style: keyof typeof DATE_STYLES = 'short'): string {
  return fmt(locale, DATE_STYLES[style]).format(wallClock(localIso));
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
