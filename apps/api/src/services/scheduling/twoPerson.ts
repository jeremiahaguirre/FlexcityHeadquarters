/**
 * Two-person minimum (working-alone rule). Positions and shifts flagged "never alone" (confined
 * space entry, certain water plant tasks, late pool closes) need at least two qualified people on
 * site for the whole shift: the person on it and at least one other person, at the same facility,
 * who is qualified for that position (holds it) and has a shift overlapping it.
 *
 * Pure: the solver, the planner, the coverage check and the publish check all call this, so they
 * agree on what a violation is.
 */
import type { Interval } from '../../lib/time.js';

export interface TwoPersonShift {
  id: string;
  userId: string | null;
  facilityId: string;
  positionId: string;
  start: Date;
  end: Date;
  neverAlone: boolean;
}

export interface TwoPersonViolation {
  shiftId: string;
  userId: string;
  facilityId: string;
  positionId: string;
  /** Stretches of the shift with no qualified second person. */
  alone: Interval[];
  aloneHours: number;
}

/** Shift's own flag, else its position's. */
export const isNeverAlone = (shift: { neverAlone?: boolean | null }, position?: { neverAlone?: boolean | null } | null) => shift.neverAlone ?? position?.neverAlone ?? false;

/**
 * Every assigned never-alone shift with stretches where no second qualified person overlaps.
 * `qualified(userId, positionId)`: whether a person holds a position. Open (unassigned) shifts
 * don't count as company, and nor does a cancelled one (callers pass only live shifts).
 */
export function twoPersonViolations(shifts: ReadonlyArray<TwoPersonShift>, qualified: (userId: string, positionId: string) => boolean): TwoPersonViolation[] {
  const out: TwoPersonViolation[] = [];
  const byFacility = new Map<string, TwoPersonShift[]>();
  for (const s of shifts) if (s.userId) byFacility.set(s.facilityId, [...(byFacility.get(s.facilityId) ?? []), s]);
  for (const s of shifts) {
    if (!s.neverAlone || !s.userId) continue;
    const a = s.start.getTime();
    const b = s.end.getTime();
    const company = (byFacility.get(s.facilityId) ?? [])
      .filter((o) => o.id !== s.id && o.userId && o.userId !== s.userId && o.start.getTime() < b && o.end.getTime() > a && qualified(o.userId, s.positionId))
      .map((o) => [Math.max(a, o.start.getTime()), Math.min(b, o.end.getTime())] as const)
      .sort((x, y) => x[0] - y[0]);
    const alone: Interval[] = [];
    let cursor = a;
    for (const [x, y] of company) {
      if (x > cursor) alone.push({ start: new Date(cursor), end: new Date(x) });
      cursor = Math.max(cursor, y);
    }
    if (cursor < b) alone.push({ start: new Date(cursor), end: new Date(b) });
    // Ignore slivers under a minute (rounding of times).
    const real = alone.filter((x) => x.end.getTime() - x.start.getTime() >= 60_000);
    if (real.length) out.push({ shiftId: s.id, userId: s.userId, facilityId: s.facilityId, positionId: s.positionId, alone: real, aloneHours: Math.round((real.reduce((t, x) => t + x.end.getTime() - x.start.getTime(), 0) / 3_600_000) * 100) / 100 });
  }
  return out;
}
