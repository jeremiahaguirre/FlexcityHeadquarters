import { describe, expect, it } from 'vitest';
import { StreamSlots, msUntilExpiry } from '../../src/lib/streamSlots.js';

describe('live stream limits (SECURITY-AUDIT SEC-70)', () => {
  it('past the per-person limit, the oldest stream of that person is closed', () => {
    const slots = new StreamSlots(3, 100);
    const closed: number[] = [];
    const releases = [0, 1, 2, 3, 4].map((i) => slots.admit('u1', () => closed.push(i)));
    expect(closed).toEqual([0, 1]);
    expect(slots.count('u1')).toBe(3);
    // Another person is unaffected.
    slots.admit('u2', () => closed.push(99));
    expect(slots.count('u2')).toBe(1);
    // Releasing a stream that was already closed changes nothing; releasing a live one frees it.
    releases[0]!();
    expect(slots.count('u1')).toBe(3);
    releases[4]!();
    expect(slots.count('u1')).toBe(2);
    expect(slots.count()).toBe(3);
  });

  it('past the per-process limit, a new stream is refused', () => {
    const slots = new StreamSlots(10, 2);
    expect(slots.admit('a', () => undefined)).not.toBeNull();
    const r = slots.admit('b', () => undefined);
    expect(slots.admit('c', () => undefined)).toBeNull();
    r!();
    expect(slots.admit('c', () => undefined)).not.toBeNull();
  });

  it('a stream lasts until the access token that opened it expires', () => {
    const now = 1_700_000_000_000;
    expect(msUntilExpiry(now / 1000 + 900, now)).toBe(900_000);
    expect(msUntilExpiry(now / 1000 - 5, now)).toBe(1000);
    expect(msUntilExpiry(undefined, now)).toBeNull();
  });
});
