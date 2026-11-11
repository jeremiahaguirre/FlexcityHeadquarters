/**
 * Statutory (general / public) holidays for each Canadian jurisdiction, as rules
 * so any year can be worked out. The forecast and payroll read them from the
 * StatutoryHoliday table, which `seedStatHolidays` fills from these rules.
 *
 * Each list is what the jurisdiction's employment standards law names as a paid
 * general holiday for most employees; days that are widely observed but not
 * statutory (Ontario's Civic Holiday, Alberta's Heritage Day, Boxing Day outside
 * Ontario and federal workplaces, Easter Monday outside the federal public
 * service's agreements, Yukon's Heritage Day) are left out. Dates are the day
 * itself: when one falls on a weekend, each law's "day off in lieu" rule applies
 * on top (not modelled here).
 *
 * Notes on the less obvious ones:
 * - Federal (Canada Labour Code s. 166): ten days, including Boxing Day and the
 *   National Day for Truth and Reconciliation. Not stored in the table (it's keyed
 *   by province), used for federally regulated work and shown for reference.
 * - Quebec: Good Friday OR Easter Monday at the employer's choice (we store Good
 *   Friday); National Patriots' Day is the Monday before May 25; the Fête nationale
 *   (Saint-Jean-Baptiste) is June 24.
 * - Nova Scotia: Remembrance Day is under its own Act (a paid day off when it falls
 *   on a working day), so it's included with the six Labour Standards Code days.
 * - Manitoba: September 30 is a general holiday from 2024; Remembrance Day is not.
 * - Newfoundland and Labrador: July 1 is Memorial Day.
 */
import type { Province } from '@prisma/client';

export type Jurisdiction = Province | 'FED';
export type HolidayKey =
  | 'NEW_YEAR'
  | 'FAMILY_DAY'
  | 'GOOD_FRIDAY'
  | 'VICTORIA_DAY'
  | 'PATRIOTS_DAY'
  | 'INDIGENOUS_PEOPLES_DAY'
  | 'FETE_NATIONALE'
  | 'CANADA_DAY'
  | 'NUNAVUT_DAY'
  | 'CIVIC_HOLIDAY'
  | 'DISCOVERY_DAY'
  | 'LABOUR_DAY'
  | 'TRUTH_RECONCILIATION'
  | 'THANKSGIVING'
  | 'REMEMBRANCE_DAY'
  | 'CHRISTMAS'
  | 'BOXING_DAY';

export type StatHoliday = { date: string; key: HolidayKey; name: string; nameFr: string };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Day of week (0 = Sunday) of a calendar date. */
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
/** The nth (1-based) given weekday of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = dow(y, m, 1);
  return ymd(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}
/** The last Monday before May 25 (Victoria Day, National Patriots' Day). */
function mondayBeforeMay25(y: number): string {
  const back = (dow(y, 5, 24) + 6) % 7; // days back from May 24 to a Monday
  return ymd(y, 5, 24 - back);
}
/** Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm. */
export function easterSunday(y: number): { month: number; day: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}
function goodFriday(y: number): string {
  const { month, day } = easterSunday(y);
  const t = new Date(Date.UTC(y, month - 1, day - 2));
  return t.toISOString().slice(0, 10);
}

type Rule = (y: number) => string;
const RULES: Record<HolidayKey, { rule: Rule; name: string; nameFr: string }> = {
  NEW_YEAR: { rule: (y) => ymd(y, 1, 1), name: 'New Year’s Day', nameFr: 'Jour de l’An' },
  FAMILY_DAY: { rule: (y) => nthWeekday(y, 2, 1, 3), name: 'Family Day', nameFr: 'Fête de la famille' },
  GOOD_FRIDAY: { rule: goodFriday, name: 'Good Friday', nameFr: 'Vendredi saint' },
  VICTORIA_DAY: { rule: mondayBeforeMay25, name: 'Victoria Day', nameFr: 'Fête de Victoria' },
  PATRIOTS_DAY: { rule: mondayBeforeMay25, name: 'National Patriots’ Day', nameFr: 'Journée nationale des patriotes' },
  INDIGENOUS_PEOPLES_DAY: { rule: (y) => ymd(y, 6, 21), name: 'National Indigenous Peoples Day', nameFr: 'Journée nationale des peuples autochtones' },
  FETE_NATIONALE: { rule: (y) => ymd(y, 6, 24), name: 'Fête nationale (Saint-Jean-Baptiste)', nameFr: 'Fête nationale du Québec' },
  CANADA_DAY: { rule: (y) => ymd(y, 7, 1), name: 'Canada Day', nameFr: 'Fête du Canada' },
  NUNAVUT_DAY: { rule: (y) => ymd(y, 7, 9), name: 'Nunavut Day', nameFr: 'Jour du Nunavut' },
  CIVIC_HOLIDAY: { rule: (y) => nthWeekday(y, 8, 1, 1), name: 'Civic Holiday', nameFr: 'Congé civique' },
  DISCOVERY_DAY: { rule: (y) => nthWeekday(y, 8, 1, 3), name: 'Discovery Day', nameFr: 'Jour de la Découverte' },
  LABOUR_DAY: { rule: (y) => nthWeekday(y, 9, 1, 1), name: 'Labour Day', nameFr: 'Fête du Travail' },
  TRUTH_RECONCILIATION: { rule: (y) => ymd(y, 9, 30), name: 'National Day for Truth and Reconciliation', nameFr: 'Journée nationale de la vérité et de la réconciliation' },
  THANKSGIVING: { rule: (y) => nthWeekday(y, 10, 1, 2), name: 'Thanksgiving', nameFr: 'Action de grâce' },
  REMEMBRANCE_DAY: { rule: (y) => ymd(y, 11, 11), name: 'Remembrance Day', nameFr: 'Jour du Souvenir' },
  CHRISTMAS: { rule: (y) => ymd(y, 12, 25), name: 'Christmas Day', nameFr: 'Noël' },
  BOXING_DAY: { rule: (y) => ymd(y, 12, 26), name: 'Boxing Day', nameFr: 'Lendemain de Noël' },
};

/** Local names where a jurisdiction calls a day something else. */
const LOCAL_NAMES: Partial<Record<Jurisdiction, Partial<Record<HolidayKey, { name: string; nameFr: string }>>>> = {
  BC: { CIVIC_HOLIDAY: { name: 'British Columbia Day', nameFr: 'Jour de la Colombie-Britannique' } },
  SK: { CIVIC_HOLIDAY: { name: 'Saskatchewan Day', nameFr: 'Fête de la Saskatchewan' } },
  MB: { FAMILY_DAY: { name: 'Louis Riel Day', nameFr: 'Journée Louis-Riel' } },
  NB: { CIVIC_HOLIDAY: { name: 'New Brunswick Day', nameFr: 'Jour du Nouveau-Brunswick' } },
  NS: { FAMILY_DAY: { name: 'Heritage Day', nameFr: 'Jour du patrimoine' } },
  PE: { FAMILY_DAY: { name: 'Islander Day', nameFr: 'Fête des Insulaires' } },
  NL: { CANADA_DAY: { name: 'Memorial Day / Canada Day', nameFr: 'Jour du Souvenir (T.-N.-L.) / Fête du Canada' } },
};

/** Which days each jurisdiction's law makes general holidays. */
export const JURISDICTION_HOLIDAYS: Record<Jurisdiction, HolidayKey[]> = {
  FED: ['NEW_YEAR', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS', 'BOXING_DAY'],
  BC: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'CIVIC_HOLIDAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  AB: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'LABOUR_DAY', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  SK: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'CIVIC_HOLIDAY', 'LABOUR_DAY', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  MB: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'THANKSGIVING', 'CHRISTMAS'],
  ON: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'LABOUR_DAY', 'THANKSGIVING', 'CHRISTMAS', 'BOXING_DAY'],
  QC: ['NEW_YEAR', 'GOOD_FRIDAY', 'PATRIOTS_DAY', 'FETE_NATIONALE', 'CANADA_DAY', 'LABOUR_DAY', 'THANKSGIVING', 'CHRISTMAS'],
  NB: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'CANADA_DAY', 'CIVIC_HOLIDAY', 'LABOUR_DAY', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  NS: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'CANADA_DAY', 'LABOUR_DAY', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  PE: ['NEW_YEAR', 'FAMILY_DAY', 'GOOD_FRIDAY', 'CANADA_DAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  NL: ['NEW_YEAR', 'GOOD_FRIDAY', 'CANADA_DAY', 'LABOUR_DAY', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  YT: ['NEW_YEAR', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'INDIGENOUS_PEOPLES_DAY', 'CANADA_DAY', 'DISCOVERY_DAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  NT: ['NEW_YEAR', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'INDIGENOUS_PEOPLES_DAY', 'CANADA_DAY', 'CIVIC_HOLIDAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
  NU: ['NEW_YEAR', 'GOOD_FRIDAY', 'VICTORIA_DAY', 'CANADA_DAY', 'NUNAVUT_DAY', 'CIVIC_HOLIDAY', 'LABOUR_DAY', 'TRUTH_RECONCILIATION', 'THANKSGIVING', 'REMEMBRANCE_DAY', 'CHRISTMAS'],
};

export const PROVINCES = Object.keys(JURISDICTION_HOLIDAYS).filter((j) => j !== 'FED') as Province[];

/** One jurisdiction's statutory holidays in a year, in date order. */
export function statHolidays(j: Jurisdiction, year: number): StatHoliday[] {
  return JURISDICTION_HOLIDAYS[j]
    .map((key) => {
      const r = RULES[key];
      const local = LOCAL_NAMES[j]?.[key];
      return { date: r.rule(year), key, name: local?.name ?? r.name, nameFr: local?.nameFr ?? r.nameFr };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

type HolidayStore = {
  statutoryHoliday: {
    upsert(args: { where: { province_date: { province: Province; date: Date } }; update: { name: string; nameFr: string }; create: { province: Province; date: Date; name: string; nameFr: string } }): Promise<unknown>;
  };
};

/** Fills the holiday table for every province and territory for the given years. Safe to re-run. */
export async function seedStatHolidays(db: HolidayStore, years: number[]): Promise<number> {
  let n = 0;
  for (const year of years) {
    for (const province of PROVINCES) {
      for (const h of statHolidays(province, year)) {
        const date = new Date(`${h.date}T00:00:00Z`);
        await db.statutoryHoliday.upsert({ where: { province_date: { province, date } }, update: { name: h.name, nameFr: h.nameFr }, create: { province, date, name: h.name, nameFr: h.nameFr } });
        n++;
      }
    }
  }
  return n;
}
