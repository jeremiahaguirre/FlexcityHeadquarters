import { describe, expect, it } from 'vitest';
import { checkHoursOfService, parseHoursOfService } from '../../src/services/scheduling/eligibility.js';

const at = (d: string, h: number) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
const shift = (d: string, from: number, to: number) => ({ start: at(d, from), end: at(d, to) });
const hos = { maxDailyHours: 13, minRestHours: 8, maxHoursIn7Days: 70 };

describe('hours of service', () => {
  it('reads stored limits; empty or zero means none', () => {
    expect(parseHoursOfService(null)).toBeNull();
    expect(parseHoursOfService({ maxDailyHours: 0 })).toBeNull();
    expect(parseHoursOfService({ maxDailyHours: 13, junk: 'x' })).toEqual({ maxDailyHours: 13, minRestHours: null, maxHoursIn7Days: null });
  });

  it('daily limit counts every shift that day', () => {
    expect(checkHoursOfService([shift('2026-12-01', 4, 12)], shift('2026-12-01', 13, 19), hos, 'UTC').map((r) => r.code)).toContain('HOS_DAILY');
    expect(checkHoursOfService([shift('2026-12-01', 4, 10)], shift('2026-12-01', 18, 23), hos, 'UTC')).toEqual([]);
  });

  it('needs the off-duty gap between driving shifts', () => {
    const r = checkHoursOfService([shift('2026-12-01', 6, 16)], shift('2026-12-01', 20, 23), hos, 'UTC');
    expect(r.map((x) => x.code)).toEqual(['HOS_REST']);
  });

  it('caps hours in any 7 days', () => {
    const week = ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].map((d) => shift(d, 6, 18)); // 72h
    expect(checkHoursOfService(week, shift('2026-12-01', 6, 10), hos, 'UTC').map((x) => x.code)).toContain('HOS_WEEKLY');
  });
});
