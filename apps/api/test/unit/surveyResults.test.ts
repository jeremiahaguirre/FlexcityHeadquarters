import { describe, expect, it } from 'vitest';
import { type Question, anonymousResults, normalizeQuestions, showableGroups, validateAnswers } from '../../src/services/surveys/results.js';

const Q: Question[] = [
  { id: 'r', type: 'RATING', text: 'Rate', required: true },
  { id: 'c', type: 'CHOICE', text: 'Pick', options: ['a', 'b'], required: true },
  { id: 'm', type: 'MULTI', text: 'Many', options: ['x', 'y'], required: false },
  { id: 't', type: 'TEXT', text: 'Say', required: false },
];

describe('answers', () => {
  it('checks each type and drops what wasn’t asked', () => {
    expect(validateAnswers(Q, { r: 3, c: 'a', m: ['x', 'x'], t: ' hi ', extra: 1 })).toEqual({ ok: true, answers: { r: 3, c: 'a', m: ['x'], t: 'hi' } });
    expect(validateAnswers(Q, { r: 6, c: 'a' }).ok).toBe(false);
    expect(validateAnswers(Q, { r: 2, c: 'z' }).ok).toBe(false);
    expect(validateAnswers(Q, { c: 'a' }).ok).toBe(false);
    expect(validateAnswers(Q, { r: 1, c: 'b', m: ['nope'] }).ok).toBe(false);
  });
  it('questions get unique ids', () => {
    const qs = normalizeQuestions([{ type: 'TEXT', text: 'One', required: true, id: 'abcd' }, { type: 'TEXT', text: 'Two', required: true, id: 'abcd' }]);
    expect(new Set(qs.map((q) => q.id)).size).toBe(2);
  });
});

describe('re-identification', () => {
  it('hides small groups, and enough others that nothing can be worked out by subtraction', () => {
    expect([...showableGroups(new Map([['a', 6], ['b', 7]]), 5)].sort()).toEqual(['a', 'b']);
    expect([...showableGroups(new Map([['a', 6], ['b', 7], ['c', 2]]), 5)]).toEqual(['b']);
    expect([...showableGroups(new Map([['a', 6], [null, 1]]), 5)]).toEqual([]);
    expect([...showableGroups(new Map([['a', 6], ['b', 3], ['c', 3]]), 5)]).toEqual(['a']);
  });
  it('nothing for fewer than the minimum group, or while open', () => {
    const rs = Array.from({ length: 4 }, (_, i) => ({ answers: { r: i + 1, c: 'a', t: `note ${i}` }, departmentId: 'd', positionId: null }));
    expect(anonymousResults(Q, rs, 5, true, 'DEPARTMENT')).toEqual({ total: 4, minGroup: 5, shown: false, reason: 'tooFew' });
    expect(anonymousResults(Q, [...rs, rs[0]!], 5, false, 'DEPARTMENT')).toMatchObject({ shown: false, reason: 'open' });
    const ok = anonymousResults(Q, [...rs, { answers: { r: 5, c: 'b', t: 'A first' }, departmentId: 'd', positionId: null }], 5, true, 'DEPARTMENT');
    expect(ok.questions!.find((q) => q.id === 't')!.texts![0]).toBe('A first');
    expect(ok.questions!.find((q) => q.id === 'r')!.average).toBe(3);
    expect(ok.breakdown!.groups[0]!.questions.find((q) => q.id === 't')!.texts).toBeUndefined();
  });

  // Security review H2: two breakdowns, each suppressed on its own, could be subtracted from each
  // other (department A minus position P1 in it = the one P2 answer). One dimension per survey.
  it('a survey breaks down by one dimension only, so a department minus a position can’t isolate anyone', () => {
    const q: Question[] = [{ id: 'q1', type: 'RATING', text: 'How safe do you feel?', required: true }];
    const r = (v: number, d: string | null, p: string | null) => ({ answers: { q1: v }, departmentId: d, positionId: p });
    const rs = [
      r(5, 'A', 'P1'), r(5, 'A', 'P1'), r(5, 'A', 'P1'), r(5, 'A', 'P1'), r(5, 'A', 'P1'),
      r(1, 'A', 'P2'),
      r(4, 'B', 'P3'), r(4, 'B', 'P3'), r(4, 'B', 'P3'), r(4, 'B', 'P3'), r(4, 'B', 'P3'),
      r(3, 'B', null), r(3, 'B', null), r(3, 'B', null), r(3, 'B', null),
    ];
    const byDept = anonymousResults(q, rs, 5, true, 'DEPARTMENT');
    expect(byDept.breakdown!.by).toBe('DEPARTMENT');
    expect(JSON.stringify(byDept)).not.toMatch(/"P1"|"P2"|"P3"/);
    const byPos = anonymousResults(q, rs, 5, true, 'POSITION');
    expect(JSON.stringify(byPos)).not.toMatch(/"A"|"B"/);
    // The total minus the groups shown is 0 or at least the minimum group.
    for (const res of [byDept, byPos]) expect(res.breakdown!.hidden === 0 || res.breakdown!.hidden >= 5).toBe(true);
    const none = anonymousResults(q, rs, 5, true, 'NONE');
    expect(none.breakdown).toBeUndefined();
    expect(none.total).toBe(15);
  });
});
