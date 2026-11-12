/** Shift bidding: seniority order and tie-breaks, round-robin awards with eligibility, every outcome explained, lines from a template. */
import { describe, expect, it } from 'vitest';
import { awardBids, buildLines, seniorityOrder, tiebreakOf } from '../../src/services/scheduling/bidding.js';

const p = (userId: string, seniorityDate: string | null, seniorityHours: number, hireDate: string | null = null, tiebreak = userId) => ({ userId, seniorityDate, seniorityHours, hireDate, tiebreak });

describe('seniority order', () => {
  const people = [p('newer', '2020-05-01', 9000), p('older', '2012-03-01', 4000), p('sameA', '2015-01-01', 5000, '2014-06-01'), p('sameB', '2015-01-01', 5000, '2014-01-01'), p('none', null, 12000)];
  it('by date: earliest seniority date, then most hours, then hire date; no date last', () => {
    expect(seniorityOrder(people, 'DATE').map((x) => x.userId)).toEqual(['older', 'sameB', 'sameA', 'newer', 'none']);
  });
  it('by hours: most hours first, then date', () => {
    expect(seniorityOrder(people, 'HOURS').map((x) => x.userId)).toEqual(['none', 'newer', 'sameB', 'sameA', 'older']);
  });
  it('a full tie goes to the recorded deterministic tie-break', () => {
    const a = p('a', '2015-01-01', 100, '2014-01-01', tiebreakOf('round-1', 'a'));
    const b = p('b', '2015-01-01', 100, '2014-01-01', tiebreakOf('round-1', 'b'));
    const first = seniorityOrder([a, b], 'DATE')[0]!.userId;
    expect(seniorityOrder([b, a], 'DATE')[0]!.userId).toBe(first);
    expect(tiebreakOf('round-1', 'a')).toBe(tiebreakOf('round-1', 'a'));
    expect(tiebreakOf('round-1', 'a')).not.toBe(tiebreakOf('round-2', 'a'));
  });
});

describe('awards', () => {
  const ok = () => null;
  it('the most senior gets their first choice; the next gets their highest still open, and is told why', () => {
    const r = awardBids({ entrants: [{ userId: 'senior', choices: ['x', 'y'] }, { userId: 'junior', choices: ['x', 'y'] }], maxAwards: 1, check: ok });
    expect(r.awards.map((a) => [a.userId, a.itemId])).toEqual([['senior', 'x'], ['junior', 'y']]);
    expect(r.outcomes.get('junior')).toEqual([{ itemId: 'x', rank: 1, result: 'TAKEN_BY_SENIOR', pass: 1 }, { itemId: 'y', rank: 2, result: 'AWARDED', pass: 1 }]);
    expect(r.outcomes.get('senior')![1]).toMatchObject({ itemId: 'y', result: 'LIMIT_REACHED' });
  });

  it('skips a choice the person can’t work and says which rule', () => {
    const r = awardBids({ entrants: [{ userId: 'a', choices: ['x', 'y'] }], maxAwards: 1, check: (_u, item) => (item === 'x' ? 'MISSING_CERTIFICATION' : null) });
    expect(r.awards).toEqual([{ itemId: 'y', userId: 'a', pass: 1, choiceRank: 2 }]);
    expect(r.outcomes.get('a')![0]).toEqual({ itemId: 'x', rank: 1, result: 'NOT_ELIGIBLE', code: 'MISSING_CERTIFICATION' });
  });

  it('several awards each: round robin by seniority, eligibility re-checked with what they already won', () => {
    // 'y' overlaps 'x' for anyone who already won 'x'.
    const check = (_u: string, item: string, won: readonly string[]) => (item === 'y' && won.includes('x') ? 'OVERLAPPING_SHIFT' : null);
    const r = awardBids({ entrants: [{ userId: 's', choices: ['x', 'y', 'z'] }, { userId: 'j', choices: ['x', 'z', 'w'] }], maxAwards: 2, check });
    expect(r.awards.map((a) => `${a.pass}:${a.userId}:${a.itemId}`)).toEqual(['1:s:x', '1:j:z', '2:j:w']);
    // s's second pass: y overlaps x, z was taken in pass 1 by someone after them in the order.
    expect(r.outcomes.get('s')).toEqual([
      { itemId: 'x', rank: 1, result: 'AWARDED', pass: 1 },
      { itemId: 'y', rank: 2, result: 'NOT_ELIGIBLE', code: 'OVERLAPPING_SHIFT' },
      { itemId: 'z', rank: 3, result: 'TAKEN_EARLIER_PASS', pass: 1 },
    ]);
  });

  it('never gives one item twice and never more than the maximum', () => {
    const entrants = Array.from({ length: 8 }, (_, i) => ({ userId: `u${i}`, choices: ['a', 'b', 'c', 'd', 'e'].sort(() => (i % 2 ? 1 : -1)) }));
    const r = awardBids({ entrants, maxAwards: 2, check: ok });
    expect(new Set(r.awards.map((a) => a.itemId)).size).toBe(r.awards.length);
    for (const e of entrants) expect(r.awards.filter((a) => a.userId === e.userId).length).toBeLessThanOrEqual(2);
    expect(r.awards).toHaveLength(5);
    for (const [, list] of r.outcomes) for (const o of list) expect(o.result).toBeTruthy();
  });

  describe('award order: round robin or most senior first takes all', () => {
    // Both want x then y; the senior also wants z, the junior w. Two awards each.
    const entrants = [{ userId: 's', choices: ['x', 'y', 'z'] }, { userId: 'j', choices: ['x', 'y', 'w'] }];
    it('round robin (the default): one at a time, so the junior gets y before the senior’s second pick', () => {
      const r = awardBids({ entrants, maxAwards: 2, check: ok });
      expect(r.awards.map((a) => `${a.pass}:${a.userId}:${a.itemId}`)).toEqual(['1:s:x', '1:j:y', '2:s:z', '2:j:w']);
      expect(r.outcomes.get('s')![1]).toEqual({ itemId: 'y', rank: 2, result: 'TAKEN_EARLIER_PASS', pass: 1 });
      expect(awardBids({ entrants, maxAwards: 2, order: 'ROUND_ROBIN', check: ok }).awards).toEqual(r.awards);
    });
    it('most senior first: the senior takes x and y, then the junior gets what’s left', () => {
      const r = awardBids({ entrants, maxAwards: 2, order: 'SENIOR_FIRST', check: ok });
      expect(r.awards.map((a) => `${a.pass}:${a.userId}:${a.itemId}`)).toEqual(['1:s:x', '2:s:y', '1:j:w']);
      expect(r.outcomes.get('s')).toEqual([
        { itemId: 'x', rank: 1, result: 'AWARDED', pass: 1 },
        { itemId: 'y', rank: 2, result: 'AWARDED', pass: 2 },
        { itemId: 'z', rank: 3, result: 'LIMIT_REACHED' },
      ]);
      expect(r.outcomes.get('j')).toEqual([
        { itemId: 'x', rank: 1, result: 'TAKEN_BY_SENIOR', pass: 1 },
        { itemId: 'y', rank: 2, result: 'TAKEN_BY_SENIOR', pass: 2 },
        { itemId: 'w', rank: 3, result: 'AWARDED', pass: 1 },
      ]);
    });
    it('most senior first still checks each choice against what they already won', () => {
      const check = (_u: string, item: string, won: readonly string[]) => (item === 'y' && won.includes('x') ? 'OVERLAPPING_SHIFT' : null);
      const r = awardBids({ entrants, maxAwards: 2, order: 'SENIOR_FIRST', check });
      expect(r.awards.map((a) => `${a.pass}:${a.userId}:${a.itemId}`)).toEqual(['1:s:x', '2:s:z', '1:j:y', '2:j:w']);
      expect(r.outcomes.get('s')![1]).toEqual({ itemId: 'y', rank: 2, result: 'NOT_ELIGIBLE', code: 'OVERLAPPING_SHIFT' });
    });
    it('with one award each, both orders give the same result', () => {
      const many = Array.from({ length: 6 }, (_, i) => ({ userId: `u${i}`, choices: ['a', 'b', 'c', 'd'].sort(() => (i % 2 ? 1 : -1)) }));
      expect(awardBids({ entrants: many, maxAwards: 1, order: 'SENIOR_FIRST', check: ok })).toEqual(awardBids({ entrants: many, maxAwards: 1, check: ok }));
    });
  });

  it('someone who ranked nothing gets nothing; an empty round awards nothing', () => {
    expect(awardBids({ entrants: [{ userId: 'a', choices: [] }], maxAwards: 1, check: ok }).awards).toEqual([]);
    expect(awardBids({ entrants: [], maxAwards: 3, check: ok }).awards).toEqual([]);
  });
});

describe('lines from a template', () => {
  it('one line per seat of each template line, every week of the range', () => {
    const d = (day: number, h: number) => new Date(Date.UTC(2027, 6, day, h));
    const slots = [{ id: 's1', daysOfWeek: [1, 2], startMinute: 420, endMinute: 900, positionId: 'p', facilityId: 'f' }];
    const shifts = [
      { id: 'b', templateSlotId: 's1', startsAt: d(5, 14), endsAt: d(5, 22) },
      { id: 'a', templateSlotId: 's1', startsAt: d(5, 14), endsAt: d(5, 22) },
      { id: 'c', templateSlotId: 's1', startsAt: d(6, 14), endsAt: d(6, 22) },
      { id: 'd', templateSlotId: 's1', startsAt: d(6, 14), endsAt: d(6, 22) },
      { id: 'x', templateSlotId: 'other', startsAt: d(6, 14), endsAt: d(6, 22) },
    ];
    const lines = buildLines(slots, shifts);
    expect(lines.map((l) => l.shiftIds)).toEqual([['a', 'c'], ['b', 'd']]);
    expect(lines[0]!.meta).toEqual({ daysOfWeek: [1, 2], startMinute: 420, endMinute: 900 });
    // A day with one seat left (the other taken already) still makes the first line longer.
    expect(buildLines(slots, shifts.filter((s) => s.id !== 'd')).map((l) => l.shiftIds)).toEqual([['a', 'c'], ['b']]);
  });
});
