import { describe, expect, it } from 'vitest';
import { planFor } from '../../src/services/platform/releases.js';

describe('release plan for one organization', () => {
  it('changes what differs, keeps what the organization chose on purpose, skips what already matches', () => {
    expect(planFor({ shiftBidding: true, union: true, expenses: true }, { union: false }, ['union'])).toEqual({
      changes: [{ key: 'shiftBidding', from: false, to: true }],
      conflicts: [{ key: 'union', value: false }],
      unchanged: ['expenses'],
    });
  });
  it('a chosen switch that already matches is not a conflict', () => {
    expect(planFor({ union: true }, { union: true }, ['union'])).toEqual({ changes: [], conflicts: [], unchanged: ['union'] });
  });
});
