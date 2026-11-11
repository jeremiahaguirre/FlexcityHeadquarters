/** How the manual planner turns one evaluation into a drop colour and reasons. */
import { describe, expect, it } from 'vitest';
import { resolveRules } from '../../src/services/compliance/provincialRules.js';
import { type CandidateContext, type PositionSpec, type ShiftSpec, evaluateCandidate } from '../../src/services/scheduling/eligibility.js';
import { statusOf } from '../../src/services/scheduling/planner.js';
import { VAN, at, iv } from '../helpers.js';

const position: PositionSpec = { id: 'guard', minimumAge: null, requiredCertIds: ['nls'], prerequisites: new Map() };
const shift = (s: string, e: string): ShiftSpec => ({ id: 's', positionId: 'guard', timezone: VAN, start: at(s), end: at(e) });
const person = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  userId: 'u',
  status: 'ACTIVE',
  dateOfBirth: '1990-01-01',
  weeklyMaxHours: null,
  qualifiedPositionIds: new Set(['guard']),
  certExpiry: new Map([['nls', null]]),
  existingShifts: [],
  approvedTimeOff: [],
  availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: '2020-01-01', effectiveTo: null })),
  ...over,
});
const opts = { rules: resolveRules('BC', '2026-07-06', []), payWeekStartDay: 1, requireAvailability: false };
const names = new Map([['nls', 'National Lifeguard']]);
const run = (c: CandidateContext, s: ShiftSpec) => statusOf(evaluateCandidate(c, s, position, opts), c, s, names);

describe('planner status', () => {
  it('ok when nothing stands in the way', () => {
    expect(run(person(), shift('2026-07-06 09:00', '2026-07-06 13:00'))).toEqual({ status: 'ok', reasons: [] });
  });
  it('a clash says when the other shift is', () => {
    const s = shift('2026-07-06 09:00', '2026-07-06 13:00');
    expect(run(person({ existingShifts: [iv('2026-07-06 10:00', '2026-07-06 14:00')] }), s)).toEqual({ status: 'block', reasons: [{ code: 'OVERLAPPING_SHIFT', at: '10:00-14:00' }] });
  });
  it('names the missing certification', () => {
    const r = run(person({ certExpiry: new Map() }), shift('2026-07-06 09:00', '2026-07-06 13:00'));
    expect(r).toEqual({ status: 'block', reasons: [{ code: 'MISSING_CERTIFICATION', cert: 'National Lifeguard' }] });
  });
  it('overtime and being outside availability are warnings', () => {
    const r = run(person({ availability: [] }), shift('2026-07-06 06:00', '2026-07-06 16:00'));
    expect(r.status).toBe('warn');
    expect(r.reasons).toEqual([{ code: 'OVERTIME', n: [2] }, { code: 'NOT_AVAILABLE' }]);
  });
  it('rest between shifts carries the hours', () => {
    const r = run(person({ existingShifts: [iv('2026-07-05 14:00', '2026-07-05 23:00')] }), shift('2026-07-06 05:00', '2026-07-06 09:00'));
    expect(r.status).toBe('block');
    expect(r.reasons.find((x) => x.code === 'REST_BETWEEN_SHIFTS')?.n?.length).toBeGreaterThan(0);
  });
});
