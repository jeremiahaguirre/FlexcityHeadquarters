export interface MyShift { id: string; facilityId: string; positionId: string; localStartsAt: string; localEndsAt: string; startsAt: string; endsAt: string; facility: { name: string }; position: { name: string; nameFr: string | null } }

const EARLY_MS = 30 * 60_000; // clock in up to 30 minutes before a shift

/** The shift to clock in for right now: underway, or starting within 30 minutes. */
export function currentShift(shifts: MyShift[], now: number): MyShift | null {
  return shifts.find((s) => Date.parse(s.startsAt) - EARLY_MS <= now && now < Date.parse(s.endsAt)) ?? null;
}
