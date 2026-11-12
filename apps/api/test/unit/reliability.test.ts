import { describe, expect, it } from 'vitest';
import { type ScoreEvent, type ScoreShift, RULES, computeReliability, lastRestart, nextRestart, readPolicy } from '../../src/services/reliability/score.js';

const DAY = 86_400_000;
const now = new Date('2026-11-11T17:00:00Z');
const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);
const ev = (id: string, type: ScoreEvent['type'], at: Date, extra: Partial<ScoreEvent> = {}): ScoreEvent => ({ id, type, occurredAt: at, excludedReason: null, ...extra });
const shift = (id: string, at: Date): ScoreShift => ({ id, at });
const TZ = 'America/Vancouver';

describe('reliability: deductions and fading', () => {
  it('counts recent deductions in full', () => {
    const r = computeReliability([ev('a', 'NO_SHOW', ago(5))], [], now);
    expect(r.score).toBe(85);
    expect(r.counted[0]).toMatchObject({ id: 'a', points: -15, basePoints: -15, fading: false });
    expect(r.status.a).toBe('COUNTED');
  });

  it('fades a deduction to half after 60 days, in the person’s favour, and drops it after 90', () => {
    const r = computeReliability([ev('late', 'LATE_PUNCH', ago(61)), ev('drop', 'LATE_DROP', ago(70)), ev('old', 'NO_SHOW', ago(95))], [], now, { policy: { timeZone: TZ } });
    expect(r.counted.find((c) => c.id === 'late')).toMatchObject({ points: -1, fading: true });
    expect(r.counted.find((c) => c.id === 'drop')).toMatchObject({ points: -2, fading: true }); // -2.5 rounds toward the person
    expect(r.status).toMatchObject({ late: 'FADING', drop: 'FADING', old: 'AGED_OUT' });
    expect(r.changes.filter((c) => c.kind === 'EVENT').map((c) => c.points)).toEqual([-2, -1]);
  });
});

describe('reliability: recovery credits', () => {
  it('earns +1 per on-time completed shift, capped at +4 a month', () => {
    const shifts = Array.from({ length: 6 }, (_, i) => shift(`s${i}`, ago(9 - i)));
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(10))], [], now, { shifts, policy: { timeZone: TZ } });
    expect(r.score).toBe(85 + RULES.onTimeShiftMonthlyCap);
    const credit = r.changes.find((c) => c.kind === 'ON_TIME');
    expect(credit).toMatchObject({ kind: 'ON_TIME', count: 6, points: 4, applied: 4, month: '2026-11' });
  });

  it('gives a streak bonus for every 10 on-time shifts in a row, and a counted late clock-in breaks the streak', () => {
    // 10 on time across two months (cap 4 + 4) + streak bonus 2.
    const shifts = Array.from({ length: 10 }, (_, i) => shift(`s${i}`, ago(25 - i * 2)));
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(26))], [], now, { shifts, policy: { timeZone: TZ } });
    expect(r.changes.some((c) => c.kind === 'STREAK' && c.count === 10 && c.applied === 2)).toBe(true);
    expect(r.streak).toBe(10);

    // A late clock-in at shift 5: streak restarts, so no bonus.
    const late = [...shifts.slice(0, 4), shift('lateShift', ago(16)), ...shifts.slice(5)];
    const r2 = computeReliability([ev('ns', 'NO_SHOW', ago(26)), ev('lp', 'LATE_PUNCH', ago(16), { sourceId: 'lateShift' })], [], now, { shifts: late, policy: { timeZone: TZ } });
    expect(r2.changes.some((c) => c.kind === 'STREAK')).toBe(false);
    expect(r2.streak).toBe(5);
  });

  it('restores +5 for every 30 days with nothing counted', () => {
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(65))], [], now, { policy: { timeZone: TZ } });
    // Fading now (-7); then two clean 30-day stretches (+5 each) bring it back to 100 at the cap.
    expect(r.counted[0]!.points).toBe(-7);
    const clean = r.changes.filter((c) => c.kind === 'CLEAN');
    expect(clean.map((c) => c.applied)).toEqual([5, 2]);
    expect(r.score).toBe(100);
  });

  it('never goes above 100 and can’t bank credits against a later deduction', () => {
    const shifts = Array.from({ length: 20 }, (_, i) => shift(`s${i}`, ago(80 - i)));
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(5))], [], now, { shifts, policy: { timeZone: TZ } });
    expect(r.score).toBe(85);
    expect(r.changes.filter((c) => c.kind !== 'EVENT')).toEqual([]); // nothing changed while already at 100
  });

  it('counts commendations, up to +4 a month, and not retracted ones', () => {
    const notes = [
      { id: 'c1', category: 'COMMENDATION' as const, occurredAt: ago(3), retractedAt: null },
      { id: 'c2', category: 'COMMENDATION' as const, occurredAt: ago(2), retractedAt: null },
      { id: 'c3', category: 'COMMENDATION' as const, occurredAt: ago(1), retractedAt: null },
      { id: 'c4', category: 'COMMENDATION' as const, occurredAt: ago(1), retractedAt: ago(0) },
      { id: 'p', category: 'POLICY' as const, occurredAt: ago(1), retractedAt: null },
    ];
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(5))], [], now, { notes, policy: { timeZone: TZ } });
    expect(r.score).toBe(85 + RULES.commendationMonthlyCap);
    expect(r.changes.filter((c) => c.kind === 'COMMENDATION').map((c) => c.applied)).toEqual([2, 2]);
  });
});

describe('reliability: sick days and protected leave stay neutral', () => {
  const leave = [{ type: 'PROTECTED_LEAVE' as const, status: 'APPROVED' as const, startsAt: ago(14), endsAt: ago(12) }];
  it('excludes deductions during protected leave and doesn’t break the streak or the clean stretch', () => {
    const shifts = [...Array.from({ length: 5 }, (_, i) => shift(`a${i}`, ago(20 - i))), ...Array.from({ length: 5 }, (_, i) => shift(`b${i}`, ago(10 - i)))];
    const r = computeReliability([ev('ns0', 'NO_SHOW', ago(31)), ev('ns', 'NO_SHOW', ago(13)), ev('lp', 'LATE_PUNCH', ago(13), { sourceId: 'x' })], leave, now, { shifts, policy: { timeZone: TZ } });
    expect(r.excluded.map((e) => [e.id, e.code])).toEqual([['ns', 'PROTECTED'], ['lp', 'PROTECTED']]);
    expect(r.status.ns).toBe('PROTECTED');
    expect(r.streak).toBe(10);
    expect(r.changes.some((c) => c.kind === 'STREAK')).toBe(true);
    // The clean stretch runs from the counted no-show 31 days ago, through the leave.
    expect(r.changes.some((c) => c.kind === 'CLEAN')).toBe(true);
  });
  it('an excused late clock-in earns nothing but breaks nothing', () => {
    const shifts = Array.from({ length: 10 }, (_, i) => shift(`s${i}`, ago(20 - i)));
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(25)), ev('lp', 'LATE_PUNCH', ago(15), { sourceId: 's5', excludedReason: 'Bus strike' })], [], now, { shifts, policy: { timeZone: TZ } });
    expect(r.status.lp).toBe('EXCUSED');
    expect(r.streak).toBe(9);
  });
});

describe('reliability: yearly restart', () => {
  it('finds the last and next restart at local midnight (Jan 1)', () => {
    const p = { resetMonth: 1, resetDay: 1, timeZone: 'America/Toronto' };
    expect(lastRestart(now, p).toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(nextRestart(now, p).toISOString()).toBe('2027-01-01T05:00:00.000Z');
    // Just before local midnight on Dec 31 it's still the old year.
    expect(lastRestart(new Date('2027-01-01T04:59:00Z'), p).toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(lastRestart(new Date('2027-01-01T05:00:00Z'), p).toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
  it('supports a fiscal or season year (after the summer season: Sep 15)', () => {
    const p = { resetMonth: 9, resetDay: 15, timeZone: 'America/Toronto' };
    expect(lastRestart(now, p).toISOString()).toBe('2026-09-15T04:00:00.000Z');
    expect(lastRestart(new Date('2026-09-14T12:00:00Z'), p).toISOString()).toBe('2025-09-15T04:00:00.000Z');
  });
  it('handles Feb 29 in leap and other years', () => {
    const p = { resetMonth: 2, resetDay: 29, timeZone: 'UTC' };
    expect(lastRestart(new Date('2028-03-01T00:00:00Z'), p).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(lastRestart(new Date('2027-03-01T00:00:00Z'), p).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(nextRestart(new Date('2027-03-01T00:00:00Z'), p).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(readPolicy({ mode: 'RESET', resetMonth: 2, resetDay: 30 }).resetDay).toBe(1);
    expect(readPolicy({ mode: 'nope' }).mode).toBe('GRADUAL');
  });

  const events = [ev('dec', 'NO_SHOW', new Date('2025-12-20T18:00:00Z')), ev('feb', 'NO_SHOW', new Date('2026-02-10T18:00:00Z')), ev('nov', 'LATE_PUNCH', ago(3))];
  const shifts = Array.from({ length: 4 }, (_, i) => shift(`s${i}`, ago(2 - i * 0.2)));

  it('RESET: everything since the restart counts in full, nothing before it, no recovery credits', () => {
    const r = computeReliability(events, [], now, { shifts, policy: { mode: 'RESET', resetMonth: 1, resetDay: 1, timeZone: TZ } });
    expect(r.score).toBe(100 - 15 - 2);
    expect(r.status).toMatchObject({ dec: 'RESTARTED', feb: 'COUNTED', nov: 'COUNTED' });
    expect(r.changes[0]).toMatchObject({ kind: 'RESTART' });
    expect(r.changes.filter((c) => c.kind === 'ON_TIME' || c.kind === 'CLEAN')).toEqual([]);
    expect(r.restartedAt?.toISOString()).toBe('2026-01-01T08:00:00.000Z');
  });

  it('GRADUAL: the last 90 days with fading and credits, no restart', () => {
    const r = computeReliability(events, [], now, { shifts, policy: { mode: 'GRADUAL', timeZone: TZ } });
    expect(r.status).toMatchObject({ dec: 'AGED_OUT', feb: 'AGED_OUT', nov: 'COUNTED' });
    expect(r.restartedAt).toBeNull();
    expect(r.score).toBe(100); // -2, then on-time shifts earn it back
  });

  it('BOTH: gradual recovery, and nothing before a recent restart counts', () => {
    const at = new Date('2026-10-20T17:00:00Z');
    const evs = [ev('aug', 'NO_SHOW', new Date('2026-09-01T17:00:00Z')), ev('oct', 'LATE_PUNCH', new Date('2026-10-01T17:00:00Z'))];
    const policy = { mode: 'BOTH' as const, resetMonth: 9, resetDay: 15, timeZone: 'America/Toronto' };
    const r = computeReliability(evs, [], at, { policy });
    expect(r.status).toMatchObject({ aug: 'RESTARTED', oct: 'COUNTED' });
    expect(r.score).toBe(98);
    expect(r.changes[0]).toMatchObject({ kind: 'RESTART' });
    const g = computeReliability(evs, [], at, { policy: { ...policy, mode: 'GRADUAL' } });
    expect(g.score).toBe(100 - 15 - 2 + 5); // the no-show still counts, with a clean 30 days after it
  });
});

describe('reliability: monthly caps count points actually earned', () => {
  it('on-time shifts while the score is at 100 don’t use up the month: a late clock-in later that month can be earned back', () => {
    // now = Nov 11; four on-time shifts earlier in November while at 100, then a late clock-in, then one on time.
    const early = [shift('s1', ago(9)), shift('s2', ago(8)), shift('s3', ago(7)), shift('s4', ago(6))];
    const late = shift('lateShift', ago(3));
    const after = shift('s5', ago(1));
    const r = computeReliability([ev('lp', 'LATE_PUNCH', ago(3), { sourceId: 'lateShift' })], [], now, { shifts: [...early, late, after], policy: { timeZone: TZ } });
    const latePoints = r.counted.find((c) => c.id === 'lp')!.points;
    expect(r.score).toBe(100 + latePoints + RULES.onTimeShift);
    const nov = r.changes.find((c) => c.kind === 'ON_TIME' && c.month === '2026-11');
    expect(nov).toMatchObject({ applied: RULES.onTimeShift });
  });

  it('still caps what is earned in a month', () => {
    const shifts = Array.from({ length: 8 }, (_, i) => shift(`s${i}`, ago(9 - i)));
    const r = computeReliability([ev('ns', 'NO_SHOW', ago(10))], [], now, { shifts, policy: { timeZone: TZ } });
    const nov = r.changes.find((c) => c.kind === 'ON_TIME' && c.month === '2026-11');
    expect(nov && 'applied' in nov ? nov.applied : 0).toBeLessThanOrEqual(RULES.onTimeShiftMonthlyCap);
  });
});
