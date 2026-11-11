/**
 * Hours on a pay statement (and so the ROE's insurable hours): hours worked or paid as time
 * (regular, overtime, holiday worked, call-in and call-back minimums, salary, lieu time taken),
 * never the hours a premium or an amount is calculated on (shift premiums ride on hours already
 * counted; vacation and holiday pay, change premiums and standby are amounts).
 */
export const NOT_HOURS: ReadonlySet<string> = new Set(['VACATION_PAY', 'STAT_HOLIDAY_PAY', 'SHIFT_PREMIUM', 'SCHEDULE_CHANGE_PREMIUM', 'STANDBY_PAY']);

/**
 * A statement's hours from its earnings lines. Statements made before premium hours were left
 * out stored inflated hours; their lines still say what each hour was, so ROEs read them this way.
 */
export function statementHours(earnings: unknown, stored: number): number {
  if (!Array.isArray(earnings) || !earnings.length) return stored;
  let h = 0;
  for (const l of earnings as Array<{ code?: unknown; hours?: unknown }>) {
    if (typeof l?.code !== 'string') return stored;
    if (NOT_HOURS.has(l.code)) continue;
    const n = Number(l.hours ?? 0);
    if (!Number.isFinite(n)) return stored;
    h += n;
  }
  return Math.round(h * 100) / 100;
}
