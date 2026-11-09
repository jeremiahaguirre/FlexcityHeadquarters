import { DateTime } from 'luxon';

export const VAN = 'America/Vancouver';
export const TOR = 'America/Toronto';
export const EDM = 'America/Edmonton';

/** Local wall-clock time → instant. at('2026-07-06 06:00') */
export function at(local: string, zone = VAN): Date {
  return DateTime.fromFormat(local, 'yyyy-MM-dd HH:mm', { zone }).toJSDate();
}

export function iv(startLocal: string, endLocal: string, zone = VAN, positionId = 'guard') {
  return { start: at(startLocal, zone), end: at(endLocal, zone), positionId };
}
