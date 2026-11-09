import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { resolveRules } from '../../src/services/compliance/provincialRules.js';
import {
  type CandidateContext,
  type PositionSpec,
  type ShiftSpec,
  evaluateCandidate,
} from '../../src/services/scheduling/eligibility.js';
import { TOR, VAN, at, iv } from '../helpers.js';

const NLS = 'nls';
const SFA = 'sfa';

const guard: PositionSpec = {
  id: 'guard',
  minimumAge: 16,
  requiredCertIds: [NLS],
  prerequisites: new Map([[NLS, [SFA]]]),
};

const shift = (start: string, end: string, zone = VAN): ShiftSpec => ({
  id: 's1',
  positionId: 'guard',
  timezone: zone,
  start: at(start, zone),
  end: at(end, zone),
});

const candidate = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  userId: 'u1',
  status: 'ACTIVE',
  dateOfBirth: '2000-01-01',
  weeklyMaxHours: null,
  qualifiedPositionIds: new Set(['guard']),
  certExpiry: new Map([
    [NLS, '2027-06-30'],
    [SFA, '2027-06-30'],
  ]),
  existingShifts: [],
  approvedTimeOff: [],
  availability: [],
  ...over,
});

const bc = { rules: resolveRules('BC', '2026-07-01'), payWeekStartDay: 0, requireAvailability: false };
const codes = (e: ReturnType<typeof evaluateCandidate>) => e.blocks.map((b) => b.code);

describe('certifications', () => {
  it('blocks a user with no certifications (the original `every` bug)', () => {
    const e = evaluateCandidate(candidate({ certExpiry: new Map() }), shift('2026-07-06 08:00', '2026-07-06 16:00'), guard, bc);
    expect(codes(e)).toContain('MISSING_CERTIFICATION');
  });

  it('allows a user who also holds unrelated certifications', () => {
    const certs = new Map([
      [NLS, '2027-06-30'],
      [SFA, '2027-06-30'],
      ['wsi', '2027-01-01'],
    ]);
    const e = evaluateCandidate(candidate({ certExpiry: certs }), shift('2026-07-06 08:00', '2026-07-06 16:00'), guard, bc);
    expect(e.eligible).toBe(true);
  });

  it('blocks when a cert expires before the shift ends', () => {
    const certs = new Map([
      [NLS, '2026-07-05'],
      [SFA, '2027-06-30'],
    ]);
    const e = evaluateCandidate(candidate({ certExpiry: certs }), shift('2026-07-06 08:00', '2026-07-06 16:00'), guard, bc);
    expect(codes(e)).toContain('CERTIFICATION_EXPIRES');
  });

  it('treats a null expiry as non-expiring', () => {
    const certs = new Map<string, string | null>([
      [NLS, null],
      [SFA, null],
    ]);
    const e = evaluateCandidate(candidate({ certExpiry: certs }), shift('2026-07-06 08:00', '2026-07-06 16:00'), guard, bc);
    expect(e.eligible).toBe(true);
  });

  it('blocks when a prerequisite (first aid) has lapsed', () => {
    const certs = new Map([
      [NLS, '2027-06-30'],
      [SFA, '2026-01-01'],
    ]);
    const e = evaluateCandidate(candidate({ certExpiry: certs }), shift('2026-07-06 08:00', '2026-07-06 16:00'), guard, bc);
    expect(codes(e)).toContain('PREREQUISITE_LAPSED');
  });
});

describe('conflicts', () => {
  it('blocks an identical shift (missed by the original overlap test)', () => {
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-06 08:00', '2026-07-06 16:00')] }),
      shift('2026-07-06 08:00', '2026-07-06 16:00'),
      guard,
      bc,
    );
    expect(codes(e)).toContain('OVERLAPPING_SHIFT');
  });

  it('blocks an existing shift that fully contains the target', () => {
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-06 06:00', '2026-07-06 18:00')] }),
      shift('2026-07-06 08:00', '2026-07-06 12:00'),
      guard,
      bc,
    );
    expect(codes(e)).toContain('OVERLAPPING_SHIFT');
  });

  it('does not treat back-to-back shifts as overlapping', () => {
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-06 06:00', '2026-07-06 08:00')] }),
      shift('2026-07-06 08:00', '2026-07-06 12:00'),
      guard,
      bc,
    );
    expect(codes(e)).not.toContain('OVERLAPPING_SHIFT');
  });

  it('blocks multi-day approved time off by interval, not date equality', () => {
    const e = evaluateCandidate(
      candidate({ approvedTimeOff: [{ start: at('2026-07-04 00:00'), end: at('2026-07-08 00:00') }] }),
      shift('2026-07-06 08:00', '2026-07-06 16:00'),
      guard,
      bc,
    );
    expect(codes(e)).toContain('ON_APPROVED_TIME_OFF');
  });
});

describe('rest periods', () => {
  it('BC: blocks less than 8h between shifts', () => {
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-05 15:00', '2026-07-05 23:00')] }),
      shift('2026-07-06 06:00', '2026-07-06 10:00'),
      guard,
      bc,
    );
    expect(codes(e)).toContain('REST_BETWEEN_SHIFTS');
  });

  it('BC: allows a split shift completed within 12 hours', () => {
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-06 06:00', '2026-07-06 10:00')] }),
      shift('2026-07-06 14:00', '2026-07-06 18:00'),
      guard,
      bc,
    );
    expect(codes(e)).not.toContain('REST_BETWEEN_SHIFTS');
  });

  it('ON: enforces 11 consecutive hours off in the day', () => {
    const on = { rules: resolveRules('ON', '2026-07-01'), payWeekStartDay: 0, requireAvailability: false };
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-06 06:00', '2026-07-06 12:00', TOR)] }),
      shift('2026-07-06 16:00', '2026-07-06 22:00', TOR),
      guard,
      on,
    );
    expect(codes(e)).toContain('DAILY_REST');
    expect(codes(e)).not.toContain('REST_BETWEEN_SHIFTS'); // exempt: 12h worked ≤ 13h
  });
});

describe('young workers', () => {
  const instructor: PositionSpec = { id: 'guard', minimumAge: null, requiredCertIds: [], prerequisites: new Map() };

  it('blocks below the position minimum age', () => {
    const e = evaluateCandidate(candidate({ dateOfBirth: '2011-01-01' }), shift('2026-07-06 08:00', '2026-07-06 12:00'), guard, bc);
    expect(codes(e)).toContain('UNDER_MINIMUM_AGE');
  });

  it('BC: limits a 15-year-old to 4h on a school day', () => {
    const e = evaluateCandidate(candidate({ dateOfBirth: '2011-01-01' }), shift('2026-10-07 15:30', '2026-10-07 20:30'), instructor, bc);
    expect(codes(e)).toContain('YOUNG_WORKER_LIMIT');
  });

  it('BC: blocks a 15-year-old during school hours', () => {
    const e = evaluateCandidate(candidate({ dateOfBirth: '2011-01-01' }), shift('2026-10-07 13:00', '2026-10-07 15:00'), instructor, bc);
    expect(e.blocks.some((b) => /school hours/.test(b.message))).toBe(true);
  });

  it('BC: allows a 15-year-old 7h on a summer Saturday and flags parental consent', () => {
    const e = evaluateCandidate(candidate({ dateOfBirth: '2011-01-01' }), shift('2026-07-11 09:00', '2026-07-11 16:00'), instructor, bc);
    expect(e.eligible).toBe(true);
    expect(e.flags.map((f) => f.code)).toContain('PARENTAL_CONSENT_REQUIRED');
  });

  it('flags a missing date of birth instead of silently passing', () => {
    const e = evaluateCandidate(candidate({ dateOfBirth: null }), shift('2026-07-06 08:00', '2026-07-06 12:00'), guard, bc);
    expect(e.flags.map((f) => f.code)).toContain('DATE_OF_BIRTH_MISSING');
  });
});

describe('overtime & hours', () => {
  it('flags overtime but stays eligible (routes to supervisor approval)', () => {
    const e = evaluateCandidate(
      candidate({ existingShifts: [iv('2026-07-06 06:00', '2026-07-06 14:00')] }),
      shift('2026-07-06 15:00', '2026-07-06 17:00'),
      guard,
      bc,
    );
    expect(e.eligible).toBe(true);
    expect(e.overtimeHours.toNumber()).toBe(2);
    expect(e.flags.map((f) => f.code)).toContain('OVERTIME');
  });

  it('blocks when the personal weekly cap would be exceeded', () => {
    const e = evaluateCandidate(
      candidate({ weeklyMaxHours: new Decimal(10), existingShifts: [iv('2026-07-06 08:00', '2026-07-06 16:00')] }),
      shift('2026-07-07 08:00', '2026-07-07 12:00'),
      guard,
      bc,
    );
    expect(codes(e)).toContain('OVER_PERSONAL_WEEKLY_MAX');
  });
});

describe('availability', () => {
  it('requires submitted availability for assistant scheduling', () => {
    const opts = { ...bc, requireAvailability: true };
    const window = { dayOfWeek: 1, startMinute: 6 * 60, endMinute: 14 * 60, effectiveFrom: '2026-01-01', effectiveTo: null };
    const inside = evaluateCandidate(candidate({ availability: [window] }), shift('2026-07-06 08:00', '2026-07-06 12:00'), guard, opts);
    const outside = evaluateCandidate(candidate({ availability: [window] }), shift('2026-07-06 12:00', '2026-07-06 16:00'), guard, opts);
    expect(inside.eligible).toBe(true);
    expect(codes(outside)).toContain('NOT_AVAILABLE');
  });
});
