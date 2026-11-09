import { describe, expect, it } from 'vitest';
import { currentShift, type MyShift } from './punch';

const shift = (id: string, start: string, end: string) => ({ id, startsAt: start, endsAt: end }) as MyShift;

describe('one-tap clock-in picks the right shift', () => {
  const shifts = [shift('morning', '2026-11-09T14:00:00Z', '2026-11-09T18:00:00Z'), shift('evening', '2026-11-09T22:00:00Z', '2026-11-10T02:00:00Z')];
  it('up to 30 minutes early, during, but not after', () => {
    expect(currentShift(shifts, Date.parse('2026-11-09T13:29:00Z'))).toBeNull();
    expect(currentShift(shifts, Date.parse('2026-11-09T13:31:00Z'))?.id).toBe('morning');
    expect(currentShift(shifts, Date.parse('2026-11-09T17:59:00Z'))?.id).toBe('morning');
    expect(currentShift(shifts, Date.parse('2026-11-09T18:00:00Z'))).toBeNull();
    expect(currentShift(shifts, Date.parse('2026-11-09T21:45:00Z'))?.id).toBe('evening');
  });
});
