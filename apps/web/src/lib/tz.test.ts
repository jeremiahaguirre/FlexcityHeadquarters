import { describe, expect, it } from 'vitest';
import { mondayOf, zonedToInstant } from './tz';

describe('facility time zones', () => {
  it('converts wall-clock time in another zone to the right instant', () => {
    expect(zonedToInstant('2026-07-06', '06:30', 'America/Toronto').toISOString()).toBe('2026-07-06T10:30:00.000Z');
    expect(zonedToInstant('2026-12-01', '06:30', 'America/Toronto').toISOString()).toBe('2026-12-01T11:30:00.000Z');
    expect(zonedToInstant('2026-12-01', '18:00', 'America/Halifax').toISOString()).toBe('2026-12-01T22:00:00.000Z');
  });
  it('finds the Monday of the week', () => {
    expect(mondayOf('2026-11-12')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
  });
});
