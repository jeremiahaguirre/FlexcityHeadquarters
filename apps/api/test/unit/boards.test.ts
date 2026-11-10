import { describe, expect, it } from 'vitest';
import { BOARDS, reportDue, reportRequired } from '../../src/services/injury/boards.js';

describe('injury report deadlines', () => {
  it('every province and territory has a board', () => {
    expect(Object.keys(BOARDS)).toHaveLength(13);
    expect(BOARDS.ON.board).toBe('WSIB');
    expect(BOARDS.BC.board).toBe('WorkSafeBC');
  });
  it('counts calendar days, or business days where the board does', () => {
    const fri = new Date('2026-12-04T15:00:00Z'); // a Friday
    expect(reportDue('ON', fri).toISOString()).toBe('2026-12-07T15:00:00.000Z'); // 3 days
    expect(reportDue('NS', fri).toISOString()).toBe('2026-12-11T15:00:00.000Z'); // 5 business days
  });
  it('a report is needed for lost time or health care beyond first aid', () => {
    expect(reportRequired(false, false)).toBe(false);
    expect(reportRequired(true, false)).toBe(true);
    expect(reportRequired(false, true)).toBe(true);
  });
});
