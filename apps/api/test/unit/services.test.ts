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
