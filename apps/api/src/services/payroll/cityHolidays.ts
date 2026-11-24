/**
 * Holidays and closure days an organization adds on top of its provinces' statutory holidays
 * (TenantHoliday): Boxing Day or Easter Monday in a BC city's collective agreement, Ontario's
 * Civic Holiday, a closure between Christmas and New Year's.
 *
 * - PAID: a general holiday like a statutory one. Holiday pay (the province's formula), the
 *   holiday premium for hours worked, the province's day-off rule, the organization's weekday
 *   observance, and it's a day off for scheduling and leave.
 * - CLOSURE: the organization is closed (no shifts generated, leave doesn't count the day), but
 *   no holiday pay and no premium.
 *
 * A repeating rule is worked out from its first date, so nothing repeats before it:
 * YEARLY_DATE (December 26), YEARLY_NTH_WEEKDAY (the first Monday of August, from a first date
 * that is one), YEARLY_LAST_WEEKDAY (the last Monday of May) and EASTER_OFFSET (Easter Monday is
 * Easter Sunday + 1). A day the province already makes a statutory holiday is not added twice:
 * the statutory one wins.
 */
import type { HolidayRecurrence, Province, TenantHolidayKind } from '../../generated/prisma/client.js';
import { easterSunday } from './statHolidays.js';

export interface CityHolidayRule {
  id: string;
  name: string;
  nameFr: string;
  kind: TenantHolidayKind;
  /** YYYY-MM-DD: the day, or the first year's day of a repeating rule. */
  date: string;
  recurrence: HolidayRecurrence;
  untilYear: number | null;
  province: Province | null;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The rule's day in one year, or null when it doesn't fall in that year. */
export function cityHolidayIn(rule: Pick<CityHolidayRule, 'date' | 'recurrence' | 'untilYear'>, year: number): string | null {
  const [y0, m, d] = parts(rule.date);
  if (year < y0 || (rule.untilYear !== null && year > rule.untilYear)) return null;
  switch (rule.recurrence) {
    case 'NONE':
      return year === y0 ? rule.date : null;
    case 'YEARLY_DATE':
      // February 29 is kept on February 28 in other years.
      return ymd(year, m, Math.min(d, daysInMonth(year, m)));
    case 'YEARLY_NTH_WEEKDAY':
    case 'YEARLY_LAST_WEEKDAY': {
      const weekday = utc(y0, m, d).getUTCDay();
      const first = utc(year, m, 1).getUTCDay();
      const firstOn = 1 + ((weekday - first + 7) % 7);
      if (rule.recurrence === 'YEARLY_NTH_WEEKDAY') {
        const n = Math.ceil(d / 7);
        const day = firstOn + (n - 1) * 7;
        return day <= daysInMonth(year, m) ? ymd(year, m, day) : null;
      }
      let day = firstOn;
      while (day + 7 <= daysInMonth(year, m)) day += 7;
      return ymd(year, m, day);
    }
    case 'EASTER_OFFSET': {
      const e0 = easterSunday(y0);
      const offset = Math.round((utc(y0, m, d).getTime() - utc(y0, e0.month, e0.day).getTime()) / DAY);
      const e = easterSunday(year);
      return new Date(utc(year, e.month, e.day).getTime() + offset * DAY).toISOString().slice(0, 10);
    }
  }
}

/** Why a rule's first date can't start its recurrence, or null: a fifth weekday isn't there every year; a "last weekday" date must be the last one in its month. */
export function validRule(rule: Pick<CityHolidayRule, 'date' | 'recurrence' | 'untilYear'>): string | null {
  const [y0, m, d] = parts(rule.date);
  if (rule.untilYear !== null && rule.untilYear < y0) return 'UNTIL_BEFORE_START';
  if (rule.recurrence === 'YEARLY_NTH_WEEKDAY' && d > 28) return 'NTH_WEEKDAY_FIFTH';
  // The first date must itself be the last such weekday, or the day typed would never be the holiday.
  if (rule.recurrence === 'YEARLY_LAST_WEEKDAY' && d + 7 <= daysInMonth(y0, m)) return 'NOT_LAST_WEEKDAY';
  return null;
}

/** Every day of the rule in [from, to) (YYYY-MM-DD). */
export function cityHolidayDates(rule: Pick<CityHolidayRule, 'date' | 'recurrence' | 'untilYear'>, from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const d = cityHolidayIn(rule, y);
    if (d && d >= from && d < to) out.push(d);
  }
  return out;
}

/** A database row as plain values. */
export function cityRule(r: { id: string; name: string; nameFr: string; kind: TenantHolidayKind; date: Date; recurrence: HolidayRecurrence; untilYear: number | null; province: Province | null }): CityHolidayRule {
  return { id: r.id, name: r.name, nameFr: r.nameFr, kind: r.kind, date: r.date.toISOString().slice(0, 10), recurrence: r.recurrence, untilYear: r.untilYear, province: r.province };
}
