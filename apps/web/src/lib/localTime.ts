import { dateFormat } from './format';

/**
 * Formats a facility-local timestamp from the API ("2026-11-13T07:00:00.000-07:00")
 * using its wall-clock part only. The browser never converts timezones itself,
 * so stale browser tz data (e.g. after a province changes its DST rules) can't
 * shift displayed times.
 */
export function formatLocal(localIso: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const wall = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/.exec(localIso)?.[1];
  if (!wall) throw new Error(`Not a local ISO timestamp: ${localIso}`);
  return dateFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${wall}Z`));
}
