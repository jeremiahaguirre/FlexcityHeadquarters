import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { resolveRules } from '../../src/services/compliance/provincialRules.js';
import { type AssistantCandidate, proposeSchedule } from '../../src/services/scheduling/assistant.js';
import type { PositionSpec, ShiftSpec } from '../../src/services/scheduling/eligibility.js';
import { VAN, at, iv } from '../helpers.js';

const position: PositionSpec = { id: 'guard', minimumAge: null, requiredCertIds: ['nls'], prerequisites: new Map() };
const shift = (id: string, s: string, e: string): { shift: ShiftSpec; position: PositionSpec } => ({
  shift: { id, positionId: 'guard', timezone: VAN, start: at(s), end: at(e) },
  position,
});
const allWeek = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: '2026-01-01', effectiveTo: null }));

const person = (id: string, over: Partial<AssistantCandidate> = {}): AssistantCandidate => ({
  userId: id,
  status: 'ACTIVE',
  dateOfBirth: '2000-01-01',
  weeklyMaxHours: null,
  qualifiedPositionIds: new Set(['guard']),
  certExpiry: new Map([['nls', '2030-01-01']]),
  existingShifts: [],
  approvedTimeOff: [],
  availability: allWeek,
  employmentStatus: 'PART_TIME',
  shadowTier: 'UNASSIGNED',
  seniorityDate: '2020-01-01',
  seniorityHours: new Decimal(0),
  weeklyMinHours: null,
  ...over,
});

const baseInput = { rules: resolveRules('BC', '2026-07-01'), payWeekStartDay: 0, distributionMode: 'SENIORITY' as const, useShadowTiers: false };

describe('proposeSchedule', () => {
  it('fills full-time staff below their minimum before part-time', () => {
    const out = proposeSchedule({
      ...baseInput,
      shifts: [shift('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
      candidates: [person('pt', { seniorityDate: '2010-01-01' }), person('ft', { employmentStatus: 'FULL_TIME', weeklyMinHours: new Decimal(32) })],
    });
    expect(out.assignments).toEqual([{ shiftId: 's1', userId: 'ft' }]);
  });

  it('uses seniority among part-time staff', () => {
    const out = proposeSchedule({
      ...baseInput,
      shifts: [shift('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
      candidates: [person('junior', { seniorityDate: '2024-01-01' }), person('senior', { seniorityDate: '2015-01-01' })],
    });
    expect(out.assignments[0]?.userId).toBe('senior');
  });

  it('spreads hours in egalitarian mode', () => {
    const out = proposeSchedule({
      ...baseInput,
      distributionMode: 'EGALITARIAN',
      shifts: [shift('s1', '2026-07-06 08:00', '2026-07-06 12:00'), shift('s2', '2026-07-07 08:00', '2026-07-07 12:00')],
      candidates: [person('a'), person('b')],
    });
    expect(new Set(out.assignments.map((a) => a.userId))).toEqual(new Set(['a', 'b']));
  });

  it('respects manager-set shadow tiers when enabled', () => {
    const out = proposeSchedule({
      ...baseInput,
      useShadowTiers: true,
      shifts: [shift('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
      candidates: [person('senior', { seniorityDate: '2010-01-01', shadowTier: 'B_SQUAD' }), person('a', { shadowTier: 'A_SQUAD' })],
    });
    expect(out.assignments[0]?.userId).toBe('a');
  });

  it('never double-books the same person across shifts in one run', () => {
    const out = proposeSchedule({
      ...baseInput,
      shifts: [shift('s1', '2026-07-06 08:00', '2026-07-06 16:00'), shift('s2', '2026-07-06 10:00', '2026-07-06 14:00')],
      candidates: [person('only')],
    });
    expect(out.assignments).toHaveLength(1);
    expect(out.unfilled[0]?.reason).toMatch(/already scheduled/);
  });

  it('leaves overtime shifts unfilled with an explanation', () => {
    const out = proposeSchedule({
      ...baseInput,
      shifts: [shift('s1', '2026-07-06 15:00', '2026-07-06 18:00')],
      candidates: [person('busy', { existingShifts: [iv('2026-07-06 06:00', '2026-07-06 14:00')] })],
    });
    expect(out.assignments).toHaveLength(0);
    expect(out.unfilled[0]?.reason).toMatch(/overtime/);
  });

  it('explains why nobody could be scheduled', () => {
    const out = proposeSchedule({
      ...baseInput,
      shifts: [shift('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
      candidates: [person('a', { availability: [] }), person('b', { approvedTimeOff: [{ start: at('2026-07-06 00:00'), end: at('2026-07-07 00:00') }] })],
    });
    expect(out.unfilled[0]?.reason).toBe('2 candidates: 1 not available, 1 on time off.');
  });
});

describe('proposeSchedule across facilities', () => {
  const at2 = (id: string, s: string, e: string, facilityId: string, pos: PositionSpec = position) => ({ shift: { id, positionId: pos.id, timezone: VAN, start: at(s), end: at(e), facilityId }, position: pos });
  const instructor: PositionSpec = { id: 'instructor', minimumAge: null, requiredCertIds: [], prerequisites: new Map() };

  it('fills the hardest shift first, so a scarce qualification isn’t used up elsewhere', () => {
    // Same time, two pools. Only the senior guard can instruct; anyone can guard.
    const out = proposeSchedule({
      ...baseInput,
      shifts: [at2('guard', '2026-07-06 08:00', '2026-07-06 16:00', 'north'), at2('lesson', '2026-07-06 08:00', '2026-07-06 16:00', 'south', instructor)],
      candidates: [person('senior', { seniorityDate: '2010-01-01', qualifiedPositionIds: new Set(['guard', 'instructor']) }), person('junior', { seniorityDate: '2022-01-01' })],
    });
    expect(out.unfilled).toEqual([]);
    expect(out.assignments).toEqual(expect.arrayContaining([{ shiftId: 'lesson', userId: 'senior' }, { shiftId: 'guard', userId: 'junior' }]));
  });

  it('leaves time to travel between facilities', () => {
    const shifts = [at2('a', '2026-07-06 08:00', '2026-07-06 12:00', 'north'), at2('b', '2026-07-06 12:15', '2026-07-06 16:00', 'south')];
    const one = [person('only')];
    const out = proposeSchedule({ ...baseInput, shifts, candidates: one });
    expect(out.assignments).toHaveLength(1);
    expect(out.unfilled[0]!.reason).toMatch(/no time to travel/);
    // Same facility, or a short buffer: both are fine.
    expect(proposeSchedule({ ...baseInput, shifts: [shifts[0]!, at2('b', '2026-07-06 12:15', '2026-07-06 16:00', 'north')], candidates: [person('only')] }).assignments).toHaveLength(2);
    expect(proposeSchedule({ ...baseInput, travelMinutes: 10, shifts, candidates: [person('only')] }).assignments).toHaveLength(2);
  });

  it('prefers whoever already works at that facility, other things equal', () => {
    const out = proposeSchedule({
      ...baseInput,
      distributionMode: 'EGALITARIAN',
      shifts: [at2('x', '2026-07-08 08:00', '2026-07-08 12:00', 'south')],
      candidates: [
        person('a', { existingShifts: [{ start: at('2026-07-06 08:00'), end: at('2026-07-06 12:00'), positionId: 'guard', facilityId: 'north' }] }),
        person('b', { existingShifts: [{ start: at('2026-07-06 08:00'), end: at('2026-07-06 12:00'), positionId: 'guard', facilityId: 'south' }] }),
      ],
    });
    expect(out.assignments).toEqual([{ shiftId: 'x', userId: 'b' }]);
  });

  it('checks each shift against its own facility’s province', () => {
    const out = proposeSchedule({
      ...baseInput,
      shifts: [{ ...at2('qc', '2026-07-06 08:00', '2026-07-06 16:00', 'gatineau'), rules: resolveRules('QC', '2026-07-01') }],
      candidates: [person('a')],
    });
    expect(out.assignments).toHaveLength(1);
  });
});
