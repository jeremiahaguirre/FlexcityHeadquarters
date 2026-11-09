import { describe, expect, it } from 'vitest';
import { loadFixtures, lookupKey, shiftDate, within } from './demoFixtures';

describe('demo fixtures', () => {
  it('ignores date range bounds when looking up a response', () => {
    expect(lookupKey('/api/me/shifts?from=2026-11-09T00%3A00%3A00.000Z&to=2026-11-10T00%3A00%3A00.000Z')).toBe('/api/me/shifts');
    expect(lookupKey('/api/users?status=ACTIVE&q=jo')).toBe('/api/users?q=jo&status=ACTIVE');
  });

  it('moves dates by whole days and keeps the time and offset', () => {
    expect(shiftDate('2026-11-09T06:00:00-08:00', 3)).toBe('2026-11-12T06:00:00-08:00');
    expect(shiftDate('2026-12-30', 3)).toBe('2027-01-02');
    expect(shiftDate('Main Tank', 3)).toBe('Main Tank');
  });

  it('filters lists to the requested range', () => {
    const items = [{ startsAt: '2026-11-09T16:00:00Z' }, { startsAt: '2026-11-12T16:00:00Z' }];
    expect(within(items, new URLSearchParams('from=2026-11-09T00:00:00Z&to=2026-11-10T00:00:00Z'))).toEqual([items[0]]);
  });

  it('serves every role a profile, with dates moved to today', async () => {
    for (const role of ['guard', 'supervisor', 'hr', 'frontdesk', 'steward'] as const) {
      const f = await loadFixtures(role, '2030-01-15');
      expect(f.get('/api/me')).toMatchObject({ permissions: expect.any(Array) });
      expect(JSON.stringify(f.get('/api/me'))).not.toMatch(/kelowna/i);
    }
  });
});
