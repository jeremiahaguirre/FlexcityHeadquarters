import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { LocalKeyProvider, open, seal } from '../../src/services/crypto/envelope.js';
import { ThresholdsNotConfiguredError, evaluateReading, lifeguardsRequired, validateReading } from '../../src/services/ops/chemistry.js';
import { buildPayrollCsv, csvCell } from '../../src/services/payroll/export.js';
import { erasureDueDate } from '../../src/services/privacy/erasure.js';
import { computeReliability } from '../../src/services/reliability/score.js';
import { classifyPunchLocation, haversineMeters } from '../../src/services/timeclock/geofence.js';

const d = (s: string) => new Decimal(s);

describe('geofence', () => {
  const facility = { lat: 49.8801, lon: -119.4436, radiusM: 150 }; // Kelowna
  it('computes realistic distances', () => {
    expect(Math.round(haversineMeters({ lat: 49.8801, lon: -119.4436 }, { lat: 49.8811, lon: -119.4436 }))).toBe(111);
  });
  it('verifies punches inside the radius', () => {
    expect(classifyPunchLocation(facility, { lat: 49.8805, lon: -119.4436, accuracyM: 20 }).status).toBe('VERIFIED');
  });
  it('flags punches outside the radius', () => {
    expect(classifyPunchLocation(facility, { lat: 49.89, lon: -119.4436, accuracyM: 10 }).status).toBe('OUTSIDE_RADIUS');
  });
  it('flags vague readings instead of judging them', () => {
    expect(classifyPunchLocation(facility, { lat: 49.8801, lon: -119.4436, accuracyM: 500 }).status).toBe('LOW_ACCURACY');
  });
  it('handles unconfigured facilities and missing location', () => {
    expect(classifyPunchLocation({ lat: null, lon: null, radiusM: 150 }, null).status).toBe('FACILITY_NOT_CONFIGURED');
    expect(classifyPunchLocation(facility, null).status).toBe('NO_LOCATION');
  });
});

describe('reliability', () => {
  const now = new Date('2026-07-31T12:00:00Z');
  it('excludes negative events during protected leave', () => {
    const r = computeReliability(
      [
        { id: 'a', type: 'NO_SHOW', occurredAt: new Date('2026-07-10T15:00:00Z'), excludedReason: null },
        { id: 'b', type: 'LATE_PUNCH', occurredAt: new Date('2026-07-20T15:00:00Z'), excludedReason: null },
      ],
      [{ type: 'SICK', status: 'APPROVED', startsAt: new Date('2026-07-10T00:00:00Z'), endsAt: new Date('2026-07-11T00:00:00Z') }],
      now,
    );
    expect(r.score).toBe(98);
    expect(r.excluded).toEqual([{ id: 'a', type: 'NO_SHOW', reason: 'Overlaps protected leave' }]);
  });
  it('ignores events outside the 90-day window and clamps to 0–100', () => {
    const r = computeReliability(
      [
        { id: 'old', type: 'NO_SHOW', occurredAt: new Date('2026-01-01T00:00:00Z'), excludedReason: null },
        { id: 'p', type: 'PICKED_UP_SHIFT', occurredAt: new Date('2026-07-01T00:00:00Z'), excludedReason: null },
      ],
      [],
      now,
    );
    expect(r.score).toBe(100);
  });
  it('honours manager exclusions', () => {
    const r = computeReliability([{ id: 'x', type: 'NO_SHOW', occurredAt: new Date('2026-07-15T00:00:00Z'), excludedReason: 'Family emergency' }], [], now);
    expect(r.score).toBe(100);
  });
});

describe('chemistry', () => {
  const t = { freeChlorineMinPpm: d('1.0'), freeChlorineMaxPpm: d('5.0'), combinedChlorineMaxPpm: d('0.5'), phMin: d('7.2'), phMax: d('7.8') };
  it('passes in-range readings', () => {
    expect(evaluateReading(t, { freeChlorinePpm: d('2.0'), totalChlorinePpm: d('2.2'), ph: d('7.5') }).outOfRange).toBe(false);
  });
  it('flags low chlorine, bad pH and high combined chlorine', () => {
    const r = evaluateReading(t, { freeChlorinePpm: d('0.8'), totalChlorinePpm: d('1.5'), ph: d('8.0') });
    expect(r.reasons).toHaveLength(3);
  });
  it('flags missing required values', () => {
    expect(evaluateReading(t, { freeChlorinePpm: null, totalChlorinePpm: null, ph: d('7.5') }).reasons).toContain('Free chlorine not recorded');
  });
  it('refuses to evaluate a pool with no thresholds (no US defaults)', () => {
    const none = { freeChlorineMinPpm: null, freeChlorineMaxPpm: null, combinedChlorineMaxPpm: null, phMin: null, phMax: null };
    expect(() => evaluateReading(none, { freeChlorinePpm: d('1'), totalChlorinePpm: null, ph: d('7.5') })).toThrow(ThresholdsNotConfiguredError);
  });
  it('rejects impossible input as a typo, not a closure', () => {
    expect(validateReading({ freeChlorinePpm: d('2'), totalChlorinePpm: d('1'), ph: d('75') })).toHaveLength(2);
  });
  it('computes lifeguard requirements from the configured ratio', () => {
    expect(lifeguardsRequired(101, 50)).toBe(3);
    expect(lifeguardsRequired(10, null)).toBeNull();
  });
});

describe('envelope encryption', () => {
  const keys = new LocalKeyProvider(randomBytes(32));
  it('round-trips', async () => {
    const s = await seal(keys, 'local:t1', 'Guard performed a rescue', 'incident:t1:i1');
    expect(await open(keys, s, 'incident:t1:i1')).toBe('Guard performed a rescue');
  });
  it('refuses ciphertext moved to another record', async () => {
    const s = await seal(keys, 'local:t1', 'secret', 'incident:t1:i1');
    await expect(open(keys, s, 'incident:t1:i2')).rejects.toThrow();
  });
  it('refuses a data key wrapped for another tenant', async () => {
    const s = await seal(keys, 'local:t1', 'secret', 'aad');
    await expect(open(keys, { ...s, kekId: 'local:t2' }, 'aad')).rejects.toThrow();
  });
});

describe('payroll CSV export', () => {
  const line = { code: 'REGULAR' as const, positionId: 'guard', hours: d('8'), rate: d('20'), multiplier: d('1'), amount: d('160') };
  it('produces a CSV when everything is mapped', () => {
    const r = buildPayrollCsv(
      [{ userId: 'u', employeeNumber: 'E100', displayName: 'A B', costCenter: 'CC-405', lines: [line] }],
      { resolve: () => 'REG_LIFEGUARD' },
      { start: '2026-07-05', end: '2026-07-18' },
    );
    expect(r.ok && r.csv.split('\r\n')[1]).toBe('E100,REG_LIFEGUARD,8.00,20.00,160.00,CC-405,2026-07-05,2026-07-18');
  });
  it('lists every problem instead of exporting a bad file', () => {
    const r = buildPayrollCsv(
      [{ userId: 'u', employeeNumber: null, displayName: 'A B', costCenter: null, lines: [line] }],
      { resolve: () => null },
      { start: '2026-07-05', end: '2026-07-18' },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toHaveLength(3);
  });
  describe('provider layouts', () => {
    const lines = [
      line,
      { code: 'OVERTIME_1_5' as const, positionId: 'guard', hours: d('2'), rate: d('30'), multiplier: d('1.5'), amount: d('60') },
      { code: 'STAT_WORKED' as const, positionId: 'guard', hours: d('4'), rate: d('30'), multiplier: d('1.5'), amount: d('120') },
      { code: 'VACATION_PAY' as const, positionId: null, hours: d('0'), rate: d('0'), multiplier: d('0.04'), amount: d('13.60') },
    ];
    const emp = [{ userId: 'u', employeeNumber: '000123', displayName: 'A B', costCenter: 'CC-405', lines }];
    const codes = { resolve: (k: string) => ({ REGULAR: 'REG', OVERTIME_1_5: 'OT', STAT_WORKED: 'STW', VACATION_PAY: 'VAC' })[k] ?? null };
    const period = { start: '2026-07-05', end: '2026-07-18' };
    const rows = (r: ReturnType<typeof buildPayrollCsv>) => (r.ok ? r.csv.trim().split('\r\n') : []);

    it('ADP: regular and overtime hours in their columns, other hours and earnings by code', () => {
      expect(buildPayrollCsv(emp, codes, period, { format: 'adp' }).ok).toBe(false); // needs the company code
      const r = rows(buildPayrollCsv(emp, codes, period, { format: 'adp', adpCompanyCode: 'K7X', adpBatchId: '0718' }));
      expect(r[0]).toBe('Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount,Earnings 3 Code,Earnings 3 Amount');
      expect(r[1]).toBe('K7X,0718,000123,CC-405,20.00,8.00,,,,,');
      expect(r[2]).toBe('K7X,0718,000123,CC-405,30.00,,2.00,,,,');
      expect(r[3]).toBe('K7X,0718,000123,CC-405,30.00,,,STW,4.00,,');
      expect(r[4]).toBe('K7X,0718,000123,CC-405,,,,,,VAC,13.60');
    });

    it('Dayforce: XRef codes, effective at the period end', () => {
      const r = rows(buildPayrollCsv(emp, codes, period, { format: 'dayforce' }));
      expect(r[0]).toBe('EmployeeXRefCode,PayAdjCodeXRefCode,EffectiveDate,NetHours,Rate,Amount,OrgUnitXRefCode,Comment');
      expect(r[1]).toBe('000123,REG,2026-07-18,8.00,20.00,160.00,CC-405,FlexcityHeadquarters 2026-07-05 to 2026-07-18');
      expect(r[4]).toBe('000123,VAC,2026-07-18,,,13.60,CC-405,FlexcityHeadquarters 2026-07-05 to 2026-07-18');
    });

    it('Wagepoint: earning code, hours, rate and amount', () => {
      const r = rows(buildPayrollCsv(emp, codes, period, { format: 'wagepoint' }));
      expect(r[0]).toBe('Employee Number,Earning Code,Hours,Rate,Amount,Department,Period Start,Period End');
      expect(r[2]).toBe('000123,OT,2.00,30.00,60.00,CC-405,2026-07-05,2026-07-18');
    });

    it('every layout refuses the same unmapped lines', () => {
      for (const format of ['generic', 'adp', 'dayforce', 'wagepoint'] as const) {
        const r = buildPayrollCsv(emp, { resolve: () => null }, period, { format, adpCompanyCode: 'K7X' });
        expect(!r.ok && r.problems.length).toBe(4);
      }
    });
  });

  it('neutralises spreadsheet formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12.50')).toBe('-12.50');
  });
});

describe('erasure retention', () => {
  it('defers anonymization until the retention period after the last tax year', () => {
    expect(erasureDueDate(new Date('2026-08-01T00:00:00Z'), 7, new Date('2026-09-01T00:00:00Z')).toISOString().slice(0, 10)).toBe('2033-12-31');
  });
  it('allows immediate anonymization when there is no payroll history', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    expect(erasureDueDate(null, 7, now)).toEqual(now);
  });
});

import { requiredChecks, review } from '../../src/services/people/review.js';

describe('people review', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const base = { score: 100, counted: [], excludedCount: 0, notes: [], records: [] };

  it('flags nothing for a clean file', () => {
    expect(review(base, now)).toMatchObject({ attention: false, flags: [], suggestedLevel: null });
  });

  it('flags frequent lateness in 30 days but not older ones', () => {
    const late = (d: number) => ({ type: 'LATE_PUNCH' as const, occurredAt: ago(d) });
    expect(review({ ...base, counted: [late(1), late(5), late(40)] }, now).flags).toEqual([]);
    expect(review({ ...base, counted: [late(1), late(5), late(20)] }, now).flags).toEqual([{ code: 'FREQUENT_LATE', count: 3 }]);
  });

  it('suggests the next step after the most serious record still active', () => {
    const r = review({ ...base, score: 60, records: [{ level: 'VERBAL_WARNING', issuedAt: ago(100), acknowledgedAt: ago(99) }, { level: 'FINAL_WARNING', issuedAt: ago(400), acknowledgedAt: ago(399) }] }, now);
    expect(r.activeLevel).toBe('VERBAL_WARNING');
    expect(r.suggestedLevel).toBe('WRITTEN_WARNING');
  });

  it('an unsigned record is a reminder, not a reason to escalate', () => {
    const r = review({ ...base, records: [{ level: 'COACHING', issuedAt: ago(20), acknowledgedAt: null }] }, now);
    expect(r.flags).toEqual([{ code: 'UNSIGNED_RECORD', days: 20 }]);
    expect(r.suggestedLevel).toBeNull();
  });

  it('retracted notes never count; commendations are counted separately', () => {
    const r = review({ ...base, notes: [{ category: 'SAFETY_PROCEDURE', occurredAt: ago(3), retractedAt: ago(1) }, { category: 'COMMENDATION', occurredAt: ago(3), retractedAt: null }] }, now);
    expect(r.flags).toEqual([]);
    expect(r.commendations90).toBe(1);
  });

  it('asks for fair-process confirmations only on serious records', () => {
    expect(requiredChecks('WRITTEN_WARNING', true)).toEqual([]);
    expect(requiredChecks('SUSPENSION', false)).toEqual(['factsReviewed', 'protectedGrounds', 'employeeHeard', 'agreementChecked']);
    expect(requiredChecks('TERMINATION', true)).toContain('counselReviewed');
  });
});

import { chainMinutesFor, suggestRotation } from '../../src/services/ops/rotation.js';

describe('deck rotation', () => {
  const since = (m: number) => new Date(Date.parse('2026-11-10T12:00:00Z') - m * 60_000);

  it('pushes everyone one station along; the most-rested guard comes on and the last goes on break', () => {
    const s = suggestRotation(
      [{ id: 's1', occupant: 'a' }, { id: 's2', occupant: 'b' }],
      [{ userId: 'c', since: since(40) }, { userId: 'd', since: since(10) }],
      new Map(),
      120,
    );
    expect(s.assignments).toEqual([{ stationId: 's1', userId: 'c' }, { stationId: 's2', userId: 'a' }]);
    expect(s.toBreak).toEqual(['b']);
  });

  it('takes a tired guard off instead of moving them on, and brings in the next rested guard', () => {
    const s = suggestRotation(
      [{ id: 's1', occupant: 'a' }, { id: 's2', occupant: 'b' }],
      [{ userId: 'c', since: since(40) }, { userId: 'd', since: since(30) }],
      new Map([['a', 130]]),
      120,
    );
    expect(s.assignments).toEqual([{ stationId: 's1', userId: 'c' }, { stationId: 's2', userId: 'd' }]);
    expect(s.toBreak).toEqual(['a', 'b']);
  });

  it('with nobody to relieve them, guards stay put and a tired one is flagged', () => {
    const s = suggestRotation([{ id: 's1', occupant: 'a' }], [], new Map([['a', 150]]), 120);
    expect(s.assignments).toEqual([{ stationId: 's1', userId: 'a' }]);
    expect(s.stillNeedBreak).toEqual(['a']);
  });

  it('counts back-to-back stations as continuous chair time, and a break resets it', () => {
    const now = since(0);
    expect(chainMinutesFor([
      { stationId: 's2', startedAt: since(30), endedAt: null },
      { stationId: 's1', startedAt: since(60), endedAt: since(30) },
      { stationId: null, startedAt: since(75), endedAt: since(60) },
      { stationId: 's1', startedAt: since(120), endedAt: since(75) },
    ], now)).toBe(60);
  });
});

describe('deck rotation from an empty deck', () => {
  it('fills every empty station with rested guards, longest-rested first', () => {
    const at = (m: number) => new Date(Date.parse('2026-11-10T12:00:00Z') - m * 60_000);
    const s = suggestRotation([{ id: 's1', occupant: null }, { id: 's2', occupant: null }], [{ userId: 'b', since: at(5) }, { userId: 'a', since: at(50) }, { userId: 'c', since: at(1) }], new Map(), 120);
    expect(s.assignments).toEqual([{ stationId: 's1', userId: 'a' }, { stationId: 's2', userId: 'b' }]);
    expect(s.toBreak).toEqual([]);
  });
});

import { certStatusAt } from '../../src/services/ops/compliance.js';

describe('certification status at a moment', () => {
  const at = new Date('2026-07-03T21:00:00Z');
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it('valid only if issued, unexpired and verified by then', () => {
    expect(certStatusAt([], at)).toBe('MISSING');
    expect(certStatusAt([{ issueDate: d('2025-01-01'), expiryDate: d('2027-01-01'), verifiedAt: new Date('2025-01-02') }], at)).toBe('VALID');
    expect(certStatusAt([{ issueDate: d('2025-01-01'), expiryDate: d('2027-01-01'), verifiedAt: new Date('2026-08-01') }], at)).toBe('UNVERIFIED');
    expect(certStatusAt([{ issueDate: d('2024-01-01'), expiryDate: d('2026-07-02'), verifiedAt: new Date('2024-01-02') }], at)).toBe('EXPIRED');
    expect(certStatusAt([{ issueDate: d('2026-07-04'), expiryDate: null, verifiedAt: new Date('2026-07-04') }], at)).toBe('NOT_YET_VALID');
  });
  it('a renewal on file counts when one certificate is valid', () => {
    expect(certStatusAt([
      { issueDate: d('2024-01-01'), expiryDate: d('2026-06-01'), verifiedAt: new Date('2024-01-02') },
      { issueDate: d('2026-05-20'), expiryDate: d('2028-05-20'), verifiedAt: new Date('2026-05-21') },
    ], at)).toBe('VALID');
  });
});

import { hiddenMenuFor, permissionsWithOverrides, setMenu, setPermission } from '../../src/services/platform/roleOverrides.js';

describe('per-role overrides', () => {
  it('hiding a screen removes only the permissions no other visible screen needs', () => {
    const o = setMenu({}, 'AQUATIC_SUPERVISOR', '/manage/settings', false);
    // ops.configure and tenant-wide settings: supervisors have ops.configure only for settings.
    expect(o.AQUATIC_SUPERVISOR!.hideMenu).toEqual(['/manage/settings']);
    expect(permissionsWithOverrides(['AQUATIC_SUPERVISOR'], o).has('ops.configure')).toBe(false);
  });
  it('a menu item stays visible to someone if any of their roles still shows it', () => {
    const o = setMenu({}, 'STAFF', '/board', false);
    expect(hiddenMenuFor(['STAFF'], o)).toEqual(['/board']);
    expect(hiddenMenuFor(['STAFF', 'HEAD_LIFEGUARD'], o)).toEqual([]);
    expect(permissionsWithOverrides(['STAFF', 'HEAD_LIFEGUARD'], o).has('shiftboard.claim')).toBe(true);
  });
  it('permission toggles are relative to the defaults and undo cleanly', () => {
    let o = setPermission({}, 'FRONT_DESK', 'payroll.export', true);
    expect(o.FRONT_DESK!.grant).toEqual(['payroll.export']);
    o = setPermission(o, 'FRONT_DESK', 'payroll.export', false);
    expect(o.FRONT_DESK!.grant).toEqual([]);
    expect(o.FRONT_DESK!.revoke).toEqual([]);
  });
});

import { accommodationBlocks } from '../../src/services/people/accommodation.js';
import { dec } from '../../src/lib/money.js';

describe('accommodation restrictions', () => {
  const base = { startsOn: '2026-01-01', endsOn: null, maxShiftHours: null, maxWeeklyHours: null, noStartBefore: null, noEndAfter: null, daysOff: [], excludedPositionIds: [] };
  // Tue Nov 10 2026, 09:00–15:00 (UTC keeps the test free of time-zone data)
  const shift = { start: new Date('2026-11-10T09:00:00Z'), end: new Date('2026-11-10T15:00:00Z'), positionId: 'p1', timezone: 'UTC' };
  it('blocks with one generic message, never the detail', () => {
    expect(accommodationBlocks([{ ...base, maxShiftHours: 4 }], shift, dec('6'))).toEqual(["Outside this person's work restrictions."]);
  });
  it('checks start and end times, days off, positions and weekly hours', () => {
    expect(accommodationBlocks([{ ...base, noStartBefore: 10 * 60 }], shift, dec('6'))).toHaveLength(1);
    expect(accommodationBlocks([{ ...base, noEndAfter: 15 * 60 }], shift, dec('6'))).toHaveLength(0);
    expect(accommodationBlocks([{ ...base, noEndAfter: 14 * 60 }], shift, dec('6'))).toHaveLength(1);
    expect(accommodationBlocks([{ ...base, daysOff: [2] }], shift, dec('6'))).toHaveLength(1);
    expect(accommodationBlocks([{ ...base, excludedPositionIds: ['p1'] }], shift, dec('6'))).toHaveLength(1);
    expect(accommodationBlocks([{ ...base, maxWeeklyHours: 20 }], shift, dec('24'))).toHaveLength(1);
  });
  it('only applies between its dates', () => {
    expect(accommodationBlocks([{ ...base, maxShiftHours: 4, endsOn: '2026-11-09' }], shift, dec('6'))).toHaveLength(0);
  });
});

import { expectedByHour } from '../../src/services/ops/forecast.js';

describe('demand forecast', () => {
  it('averages each day’s busiest count for the same weekday and hour, keeping school days apart', () => {
    const school = (d: string) => d < '2026-06-27';
    const samples = [
      // Saturdays at 14:00 in summer: peaks 80 and 100 → 90
      { day: '2026-07-04', hour: 14, poolId: 'p', count: 60 },
      { day: '2026-07-04', hour: 14, poolId: 'p', count: 80 },
      { day: '2026-07-11', hour: 14, poolId: 'p', count: 100 },
      // A Tuesday school day at 14:00 must not mix with a summer Tuesday
      { day: '2026-06-23', hour: 14, poolId: 'p', count: 10 },
      { day: '2026-07-07', hour: 14, poolId: 'p', count: 50 },
    ];
    const f = expectedByHour(samples, school);
    expect(f('p', '2026-07-18', 14)).toEqual({ expected: 90, basedOnDays: 2 });
    expect(f('p', '2026-07-14', 14)).toEqual({ expected: 50, basedOnDays: 1 });
    expect(f('p', '2026-06-16', 14)).toEqual({ expected: 10, basedOnDays: 1 });
    expect(f('p', '2026-07-18', 9)).toBeNull();
  });
});

import { quartiles } from '../../src/services/platform/benchmarks.js';

describe('benchmark quartiles', () => {
  it('needs at least five cities so none can be picked out', () => {
    expect(quartiles([1, 2, 3, 4])).toBeNull();
    expect(quartiles([1, 2, 3, 4, 5])).toEqual({ p25: 2, p50: 3, p75: 4 });
  });
});

describe('leave hours', () => {
  it('counts overlap with shifts, else working days', async () => {
    const { leaveHoursFrom } = await import('../../src/services/people/leaveHours.js');
    const req = { startsAt: new Date('2027-01-09T08:00:00Z'), endsAt: new Date('2027-01-12T08:00:00Z') };
    expect(leaveHoursFrom(req, [{ startsAt: new Date('2027-01-09T15:00:00Z'), endsAt: new Date('2027-01-10T01:00:00Z') }])).toEqual({ hours: 10, basis: 'SHIFTS' });
    // A shift that starts before the request: only the part inside counts.
    expect(leaveHoursFrom(req, [{ startsAt: new Date('2027-01-09T06:00:00Z'), endsAt: new Date('2027-01-09T10:00:00Z') }])).toEqual({ hours: 2, basis: 'SHIFTS' });
    expect(leaveHoursFrom(req, [])).toEqual({ hours: 8, basis: 'WEEKDAYS' }); // Sat, Sun, Mon → one weekday
  });
});

describe('forecast gaps to draft shifts', async () => {
  const { gapBlocks, openAt, lessonsAt } = await import('../../src/services/ops/forecast.js');
  it('layers the gaps and splits long ones into shifts of at most eight hours', () => {
    const hours = Array.from({ length: 15 }, (_, i) => ({ hour: 6 + i, gap: i >= 4 && i < 7 ? 2 : 1 }));
    expect(gapBlocks([{ date: '2026-08-17', hours }])).toEqual([
      { date: '2026-08-17', startHour: 6, endHour: 14 },
      { date: '2026-08-17', startHour: 14, endHour: 21 },
      { date: '2026-08-17', startHour: 10, endHour: 13 },
    ]);
  });
  it('knows when the facility is open and the minimum then', () => {
    const b = [{ dayOfWeek: 1, opensMinute: 390, closesMinute: 720, minGuards: 2 }, { dayOfWeek: 1, opensMinute: 1020, closesMinute: 1260, minGuards: 1 }];
    expect(openAt(b, 1, 6)).toEqual({ open: true, minGuards: 2 });
    expect(openAt(b, 1, 13)).toEqual({ open: false, minGuards: 0 });
    expect(openAt([], 1, 13)).toBeNull();
  });
  it('needs one instructor per class with swimmers, more when over size', () => {
    const c = { positionId: 'p', daysOfWeek: [1], startMinute: 1020, endMinute: 1065, startsOn: '2026-07-01', endsOn: '2026-09-30', maxSwimmers: 6 };
    expect(lessonsAt([{ ...c, swimmers: 4 }, { ...c, swimmers: 9 }, { ...c, swimmers: 0 }], '2026-08-17', 17, 'p')).toEqual({ classes: 2, swimmers: 13, instructors: 3 });
    expect(lessonsAt([{ ...c, swimmers: 4 }], '2026-08-18', 17, 'p').classes).toBe(0);
  });
});

describe('Quebec workforce skills (1% law)', async () => {
  const { workforceSkills } = await import('../../src/services/payroll/yearEnd.js');
  const { rl1SlipNumber } = await import('../../src/services/payroll/filingXml.js');
  const tx = (cents: number) => ({ trainingSpend: { aggregate: async () => ({ _sum: { amountCents: cents } }) } }) as never;
  const rule = { rate: 0.01, threshold: 2_000_000 };
  it('owes 1% of payroll less eligible training, above the threshold only', async () => {
    expect(await workforceSkills(tx(1_500_000), 2026, 3_000_000, rule)).toMatchObject({ wsdrfSubject: true, wsdrfBeforeTraining: 30_000, trainingSpent: 15_000, wsdrfOwed: 15_000, trainingSurplus: 0 });
    expect(await workforceSkills(tx(4_000_000), 2026, 3_000_000, rule)).toMatchObject({ wsdrfOwed: 0, trainingSurplus: 10_000 });
    expect(await workforceSkills(tx(0), 2026, 1_900_000, rule)).toMatchObject({ wsdrfSubject: false, wsdrfOwed: 0 });
  });
  it('numbers RL-1 slips with a check digit', () => {
    expect(rl1SlipNumber(10000014)).toBe('100000143');
    expect(rl1SlipNumber(12345678)).toBe(`12345678${12345678 % 7}`);
    expect(rl1SlipNumber(1)).toBe('000000011');
  });
});

describe('Union Hub deployment settings', () => {
  it('won’t hand the main API the union credentials when the hub runs separately', async () => {
    const { vi } = await import('vitest');
    const keys = ['APP_DATABASE_URL', 'JWT_SECRET', 'UNION_HUB_MODE', 'UNION_DATABASE_URL', 'FLEXCITY_SERVICE'] as const;
    const run = async (env: Partial<Record<(typeof keys)[number], string>>) => {
      const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      for (const k of keys) delete process.env[k];
      Object.assign(process.env, { APP_DATABASE_URL: 'postgresql://a@localhost/x', JWT_SECRET: 'x'.repeat(32), ...env });
      try {
        vi.resetModules();
        const m = await import('../../src/config.js');
        return m.config();
      } finally {
        for (const k of keys) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
      }
    };
    await expect(run({ UNION_HUB_MODE: 'separate', UNION_DATABASE_URL: 'postgresql://u@localhost/x' })).rejects.toThrow(/Union Hub service only/);
    await expect(run({ UNION_HUB_MODE: 'separate', UNION_DATABASE_URL: 'postgresql://u@localhost/x', FLEXCITY_SERVICE: 'union' })).resolves.toBeTruthy();
    await expect(run({ UNION_HUB_MODE: 'separate' })).resolves.toBeTruthy();
    vi.resetModules();
  });
});

describe('bonus method for one-time payments', async () => {
  const { withBonusMethod } = await import('../../src/services/payroll/lumpSum.js');
  // A flat 20% tax above $500 a period, and 5% CPP, to see the method's arithmetic.
  const calc = (g: number) => {
    const tax = Math.max(0, g - 500) * 0.2;
    return { cpp: g * 0.05, cpp2: 0, ei: 0, federalTax: tax, provincialTax: 0, extraTax: 0, total: g * 0.05 + tax, employerCpp: g * 0.05, employerEi: 0, pensionable: g, insurable: g };
  };
  it('taxes the bonus as if spread over the year, and CPP on the whole amount', () => {
    const d = withBonusMethod(calc, 2000, 2600, 26);
    // P × (tax(2000 + 100) − tax(2000)) = 26 × 20 = 520, plus the regular 300.
    expect(d.federalTax).toBeCloseTo(820, 2);
    expect(d.cpp).toBeCloseTo(230, 2);
    // Taxing it as one big pay would have been 20% of 2,600 more as well here, but with brackets it'd climb; never less than the regular pay's tax.
    expect(d.federalTax).toBeGreaterThan(calc(2000).federalTax);
  });
  it('on an off-cycle run, uses the last regular pay as the estimate', () => {
    const d = withBonusMethod(calc, 0, 1300, 26, 2000);
    expect(d.federalTax).toBeCloseTo(26 * (calc(2050).federalTax - calc(2000).federalTax), 2);
  });
});

describe('RL-1 slip numbers stay with the person', async () => {
  const { assignRl1Numbers } = await import('../../src/services/payroll/filingXml.js');
  it('keeps given numbers and gives new people the next ones', () => {
    const first = assignRl1Numbers(['alice', 'bob'], 1000);
    expect(first).toEqual({ alice: 1000, bob: 1001 });
    expect(assignRl1Numbers(['aaron', 'alice', 'bob'], 1000, first)).toEqual({ alice: 1000, bob: 1001, aaron: 1002 });
  });
});

describe('several roles at once', async () => {
  const { hiddenMenuFor } = await import('../../src/services/platform/roleOverrides.js');
  const { scopeOf } = await import('../../src/services/people/customRoles.js');
  it('a screen the city hid for one role still shows when another of their roles has it', () => {
    const overrides = { STAFF: { grant: [], revoke: [], hideMenu: ['/board'] } } as never;
    expect(hiddenMenuFor(['STAFF'], overrides)).toContain('/board');
    expect(hiddenMenuFor(['STAFF', 'FRONT_DESK'], overrides)).not.toContain('/board');
  });
  it('HR administrator reaches every department, whatever department-limited role they also hold', () => {
    const access = { perms: new Set(), roles: [{ perms: ['schedule.write'], positionIds: ['p1'], facilityIds: [] }] } as never;
    expect(scopeOf(new Set() as never, access, { roles: ['HR_ADMIN', 'STAFF'], managed: { hasDepartments: true, positionIds: [], aquatic: false } })).toBeNull();
  });
});
