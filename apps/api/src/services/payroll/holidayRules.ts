/**
 * What happens when a statutory holiday falls on a day the employee doesn't work
 * (most often a weekend), per province and territory and for federally regulated
 * employers.
 *
 * Two different things are modelled, and kept apart:
 *
 * 1. A CALENDAR move fixed by law, the same for everyone (or for everyone who doesn't
 *    work that day): Canada Day on a Sunday → July 2; the Fête nationale on a Sunday →
 *    June 25 in Quebec. Stored on the holiday row (`observedOn`), see statHolidays.ts.
 * 2. The PERSONAL rule, which depends on the employee's own schedule, not on the
 *    calendar weekend: someone who works Saturday to Wednesday has a holiday on a
 *    Thursday as their day off. Worked out per person in holiday pay (payrollRun.ts),
 *    with `usuallyWorks`.
 *
 * `default` is the statute's rule. Where the statute lets the employer choose (a
 * substitute day off, or holiday pay instead), `allowed` lists the choices and the
 * organization picks one in payroll settings; a choice the province doesn't allow is
 * ignored there and the default applies. NONE is only ever a default (Alberta, and
 * Nova Scotia's Remembrance Day): an organization can always be more generous.
 *
 * Conservative by design: where we weren't sure the law allows paying instead of a day
 * off, only the substitute day is allowed. Every value ships unverified, like the rest
 * of the provincial rules (provincialRules.ts), and is on counsel's checklist
 * (docs/COMPLIANCE.md). Section numbers marked "verify" are our reading of the
 * consolidation and should be checked against the current text.
 */
import type { Province } from '../../generated/prisma/client.js';
import type { HolidayKey, Jurisdiction } from './statHolidays.js';

/** SUBSTITUTE: another day off with holiday pay. PAY: holiday pay for the day, no extra day off. NONE: nothing owed. */
export type OffDayRule = 'SUBSTITUTE' | 'PAY' | 'NONE';
export type OffDayChoice = Exclude<OffDayRule, 'NONE'>;

export interface OffDayPolicy {
  default: OffDayRule;
  /** What the organization may choose instead of the default (always includes the default when it isn't NONE). */
  allowed: OffDayChoice[];
  source: string;
  /** Holidays with their own rule in this jurisdiction. */
  perHoliday?: Partial<Record<HolidayKey, { rule: OffDayRule; source: string }>>;
}

export const OFF_DAY_POLICIES: Record<Jurisdiction, OffDayPolicy> = {
  // Canada Labour Code, Part III, Division V. s. 195: a general holiday on an employee's
  // non-working day → a holiday with pay at another time (which may be added to annual
  // vacation, or another day convenient to both). For New Year's Day, Canada Day, the
  // National Day for Truth and Reconciliation, Remembrance Day, Christmas and Boxing Day
  // on a non-working Saturday or Sunday: the working day immediately before or after
  // (s. 193, verify subsection). No pay-instead option.
  FED: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE'], source: 'Canada Labour Code ss. 193, 195 (verify subsections); Holidays Act s. 2' },
  // BC Employment Standards Act s. 44–45: an average day's pay whether or not the holiday
  // falls on the employee's day off (the Branch's interpretation of s. 45); no substitute day
  // is required. s. 48: another day may be substituted by written agreement.
  BC: { default: 'PAY', allowed: ['PAY', 'SUBSTITUTE'], source: 'Employment Standards Act (BC) ss. 44, 45, 48' },
  // Alberta Employment Standards Code (as amended 2019): no general holiday pay when the
  // holiday isn't a normal work day for the employee and they don't work it (s. 28, verify);
  // whether it's a normal work day follows their pattern of work (s. 27: worked that weekday in
  // 5 of the 9 weeks before). Nothing is owed by default; the employer may give more.
  AB: { default: 'NONE', allowed: ['PAY', 'SUBSTITUTE'], source: 'Employment Standards Code (AB) ss. 27–28 (verify)' },
  // The Saskatchewan Employment Act s. 2-32: public holiday pay (5% of the 4 weeks' wages)
  // for every public holiday, whatever the employee's days of work. No substitute day.
  SK: { default: 'PAY', allowed: ['PAY', 'SUBSTITUTE'], source: 'The Saskatchewan Employment Act s. 2-32' },
  // Manitoba Employment Standards Code: a general holiday on a non-working day → the next
  // working day off with general holiday pay, or another day agreed (within the year).
  // Pay instead needs a majority written agreement or permit, so not offered here.
  MB: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE'], source: 'Employment Standards Code (MB), general holidays (ss. 21–27, verify)' },
  // Ontario ESA s. 27(1)–(2): a public holiday on a day that isn't ordinarily a working day
  // (or during vacation) → a substitute day off with public holiday pay (within 3 months, or
  // 12 by written agreement), or, if the employee agrees in writing, public holiday pay alone.
  ON: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE', 'PAY'], source: 'Employment Standards Act, 2000 (ON) s. 27(1)–(2)' },
  // Quebec LNT ss. 60, 62, 64–65: the indemnity (1/20 of the 4 weeks' wages) is owed for
  // each statutory holiday; when it falls on the employee's day off or vacation, the
  // employer pays it or grants a compensatory day off. Fête nationale: CQLR c. F-1.1 ss. 2–4.
  QC: { default: 'PAY', allowed: ['PAY', 'SUBSTITUTE'], source: 'Act respecting labour standards (QC) ss. 60, 62, 64–65; Fête nationale Act ss. 2–4' },
  // NB Employment Standards Act s. 18 (verify subsection): a public holiday on a non-working
  // day → another day off with regular pay (the next working day, or one agreed, no later
  // than the next vacation), or a day's regular pay instead.
  NB: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE', 'PAY'], source: 'Employment Standards Act (NB) s. 18 (verify)' },
  // NS Labour Standards Code s. 38 (verify): a general holiday on a non-working day → a
  // holiday with pay on the next working day, after vacation, or another day agreed.
  // Remembrance Day is under its own Act: a paid day off only when it falls on a working day.
  NS: {
    default: 'SUBSTITUTE',
    allowed: ['SUBSTITUTE'],
    source: 'Labour Standards Code (NS) s. 38 (verify)',
    perHoliday: { REMEMBRANCE_DAY: { rule: 'NONE', source: 'Remembrance Day Act (NS), R.S.N.S. 1989, c. 394' } },
  },
  // PEI Employment Standards Act, "paid holiday on non-working day": another day off with
  // pay, usually the next working day or one agreed before the next vacation.
  PE: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE'], source: 'Employment Standards Act (PE), paid holiday on a non-working day (s. 8 of the new Act, verify)' },
  // NL Labour Standards Act: a paid holiday on a non-working day → another day off with
  // the same pay (the next working day, or a day agreed).
  NL: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE'], source: 'Labour Standards Act (NL) ss. 14–17 (verify)' },
  // Yukon Employment Standards Act: a statutory holiday on a non-working day → a holiday
  // with pay on the next working day (or added to vacation / another day agreed).
  YT: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE'], source: 'Employment Standards Act (YT), general holidays (verify section)' },
  // NWT Employment Standards Act: a holiday on a non-working day → holiday pay, or another
  // day off with pay at a time convenient to both.
  NT: { default: 'PAY', allowed: ['PAY', 'SUBSTITUTE'], source: 'Employment Standards Act (NT), general holidays (verify section)' },
  // Nunavut Labour Standards Act: a general holiday on a non-working day → a holiday with
  // pay on the next working day.
  NU: { default: 'SUBSTITUTE', allowed: ['SUBSTITUTE'], source: 'Labour Standards Act (NU), general holidays (verify section)' },
};

/** The rule for one holiday in one jurisdiction, with the organization's choice where the law allows it. */
export function offDayRule(j: Jurisdiction, key: string | null, choice: OffDayChoice | null): { rule: OffDayRule; source: string } {
  const p = OFF_DAY_POLICIES[j];
  if (choice && p.allowed.includes(choice)) return { rule: choice, source: p.source };
  const own = key ? p.perHoliday?.[key as HolidayKey] : undefined;
  return { rule: own?.rule ?? p.default, source: own?.source ?? p.source };
}

/** A province's settings summary (for payroll settings). */
export function offDaySummary(province: Province) {
  const p = OFF_DAY_POLICIES[province];
  return { province, default: p.default, allowed: p.allowed, source: p.source, exceptions: Object.entries(p.perHoliday ?? {}).map(([key, v]) => ({ key, rule: v!.rule })) };
}

const DAY = 86_400_000;
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * Whether a weekday is one the person usually works, from the days they worked before
 * the holiday: on that weekday in at least 5 of the 9 weeks before the holiday's week.
 * This is the test Alberta's Code uses to settle doubt about a "normal work day"
 * (s. 27); we use it everywhere as the employee's own pattern, since the other statutes
 * speak of a day that "would not ordinarily be a working day" without a number.
 */
export function usuallyWorks(workedDays: ReadonlySet<string>, holiday: string, weekday = weekdayOf(holiday)): boolean {
  const t = Date.parse(`${holiday}T00:00:00Z`);
  let weeks = 0;
  for (let i = 1; i <= 9; i++) {
    // The same weekday i weeks back, counted from the holiday's own weekday.
    const back = new Date(t - i * 7 * DAY + (weekday - weekdayOf(holiday)) * DAY).toISOString().slice(0, 10);
    if (workedDays.has(back)) weeks++;
  }
  return weeks >= 5;
}

export type ObservanceMode = 'STATUTORY' | 'NEXT_WEEKDAY';
export interface HolidayRowLike {
  date: string;
  key: string | null;
  name: string;
  nameFr: string | null;
  kind: 'ACTUAL' | 'MOVED' | 'MOVED_IF_OFF';
  observedOn: string | null;
  weekdayOn: string | null;
}

/** The holiday's day as the law fixes it for most people (MOVED and MOVED_IF_OFF use the moved day). */
export const statutoryDay = (h: HolidayRowLike) => (h.kind === 'ACTUAL' ? h.date : h.observedOn ?? h.date);

/** The day the organization closes / staff are off: the next weekday when it observes that way, else the statutory day. */
export const organizationDay = (h: HolidayRowLike, mode: ObservanceMode) => (mode === 'NEXT_WEEKDAY' && h.weekdayOn ? h.weekdayOn : statutoryDay(h));

/** The holiday's day for one person: Quebec's Fête nationale on a Sunday stays June 24 for someone who usually works Sundays. */
export function personalDay(h: HolidayRowLike, worksThatDay: (holiday: string) => boolean): string {
  if (h.kind === 'MOVED_IF_OFF' && worksThatDay(h.date)) return h.date;
  return statutoryDay(h);
}

/**
 * The days hours worked are paid at the holiday premium, for one person: the holiday as
 * the law fixes it for them and, where the organization observes weekend holidays on the
 * next weekday, that weekday too (the collective agreement's day). The statutory day keeps
 * its premium either way: an agreement can add to the statute, not take away from it.
 */
export function premiumDays(rows: HolidayRowLike[], mode: ObservanceMode, worksThatDay: (holiday: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const h of rows) {
    out.add(personalDay(h, worksThatDay));
    if (mode === 'NEXT_WEEKDAY' && h.weekdayOn) out.add(h.weekdayOn);
  }
  return out;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** A database row as plain dates. */
export function holidayRow(r: { date: Date; key: string | null; name: string; nameFr: string | null; kind: string; observedOn: Date | null; weekdayOn: Date | null }): HolidayRowLike {
  return { date: iso(r.date)!, key: r.key, name: r.name, nameFr: r.nameFr, kind: r.kind as HolidayRowLike['kind'], observedOn: iso(r.observedOn), weekdayOn: iso(r.weekdayOn) };
}

/**
 * Holidays whose date, statutory day or weekday falls in [from, to) (a holiday on Saturday
 * the 31st can be observed in the next period). Loads a few days either side and filters.
 */
export async function holidaysTouching(
  tx: { statutoryHoliday: { findMany(args: { where: { province: Province; date: { gte: Date; lt: Date } } }): Promise<Array<Parameters<typeof holidayRow>[0]>> } },
  province: Province,
  from: string,
  to: string,
): Promise<HolidayRowLike[]> {
  const rows = await tx.statutoryHoliday.findMany({ where: { province, date: { gte: new Date(Date.parse(`${from}T00:00:00Z`) - 4 * DAY), lt: new Date(Date.parse(`${to}T00:00:00Z`) + DAY) } } });
  return rows.map(holidayRow).filter((h) => [h.date, h.observedOn, h.weekdayOn].some((d) => d !== null && d >= from && d < to));
}
