import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import { evaluateCandidate } from '../../src/services/scheduling/eligibility.js';
import { type SolverInput, solve } from '../../src/services/scheduling/solver.js';
import { DEFAULT_WEIGHTS, effectiveSettings, parseSolverSettings, withSolverSettings } from '../../src/services/scheduling/solverSettings.js';
import { at } from '../helpers.js';
import { DAYS, RULES, options, person, position, randomWeek, slot } from '../solverFixtures.js';

/** Re-checks a result from scratch with the shared evaluator: every hard rule, every shift. */
function violations(input: SolverInput, result: ReturnType<typeof solve>): string[] {
  const out: string[] = [];
  const bySlot = new Map(input.slots.map((s) => [s.id, s]));
  const byUser = new Map<string, string[]>();
  for (const p of result.proposals) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p.slotId]);
  for (const [userId, ids] of byUser) {
    const p = input.people.find((x) => x.userId === userId)!;
    const mine = ids.map((id) => bySlot.get(id)!);
    for (const s of mine) {
      const others = [...p.existingShifts, ...mine.filter((x) => x !== s).map((x) => ({ start: x.shift.start, end: x.shift.end, positionId: x.shift.positionId, facilityId: x.shift.facilityId }))];
      const e = evaluateCandidate({ ...p, existingShifts: others }, s.shift, s.position, { rules: s.rules, payWeekStartDay: 0, requireAvailability: true, limits: { maxDailyHours: input.options.maxDailyHours, maxConsecutiveDays: input.options.maxConsecutiveDays } });
      if (!e.eligible) out.push(`${userId}@${s.id}: ${e.blocks.map((b) => b.code).join(',')}`);
      if (input.options.avoidOvertime && e.overtimeHours.gt(0)) out.push(`${userId}@${s.id}: overtime`);
      const travel = input.options.travelMinutes * 60_000;
      if (others.some((x) => x.facilityId && x.facilityId !== s.shift.facilityId && s.shift.start.getTime() - x.end.getTime() < travel && x.start.getTime() - s.shift.end.getTime() < travel)) out.push(`${userId}@${s.id}: travel`);
    }
    // Organization limits: hours a day and consecutive days.
    const daily = new Map<string, number>();
    for (const s of [...mine.map((x) => x.shift), ...p.existingShifts]) {
      const d = s.start.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
      daily.set(d, (daily.get(d) ?? 0) + (s.end.getTime() - s.start.getTime()) / 3_600_000);
    }
    for (const [d, h] of daily) if (h > input.options.maxDailyHours + 1e-9) out.push(`${userId} ${d}: ${h}h`);
    let run = 0;
    for (const d of DAYS) {
      run = daily.has(d) ? run + 1 : 0;
      if (run > input.options.maxConsecutiveDays) out.push(`${userId}: ${run} days in a row`);
    }
  }
  const counts = new Map<string, number>();
  for (const p of result.proposals) counts.set(p.slotId, (counts.get(p.slotId) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 1) out.push(`${id} given twice`);
  return out;
}

describe('solve: hard rules', () => {
  it('never breaks a hard rule across random city weeks (seeded, property-style)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const input = randomWeek(seed, 40, 90, { seed, maxConsecutiveDays: seed % 2 ? 3 : 6, maxDailyHours: seed % 3 ? 12 : 8, timeBudgetMs: 2000, maxIterations: 6000 });
      const r = solve(input);
      expect(violations(input, r), `seed ${seed}`).toEqual([]);
      expect(r.summary.filled + r.unfilled.length).toBe(input.slots.length);
    }
  });

  it('never breaks a hard rule with overtime allowed, and estimates its cost', () => {
    for (let seed = 20; seed <= 25; seed++) {
      const input = randomWeek(seed, 15, 80, { seed, avoidOvertime: false, maxIterations: 4000 });
      const r = solve(input);
      expect(violations(input, r), `seed ${seed}`).toEqual([]);
      if (r.summary.overtimeHours > 0) expect(r.summary.overtimeCost).toBeGreaterThan(0);
    }
  });

  it('young workers, time off, certifications and availability are respected', () => {
    const input: SolverInput = {
      slots: [slot('school', '2026-07-08 06:00', '2026-07-08 14:00'), slot('late', '2026-07-08 16:00', '2026-07-08 23:00')],
      people: [
        person('kid', { dateOfBirth: '2012-01-01' }), // 14: BC limits apply
        person('off', { approvedTimeOff: [{ start: at('2026-07-08 00:00'), end: at('2026-07-09 00:00') }] }),
        person('lapsed', { certExpiry: new Map([['nls', '2026-07-01']]) }),
        person('mornings', { availability: [{ dayOfWeek: 3, startMinute: 360, endMinute: 840, effectiveFrom: '2026-01-01', effectiveTo: null }] }),
      ],
      options: options(),
    };
    const r = solve(input);
    expect(violations(input, r)).toEqual([]);
    expect(r.proposals.find((p) => p.slotId === 'school')?.userId).toBe('mornings');
  });
});

describe('solve: how it chooses', () => {
  it('fills the scarcest slot first, even when it is later in the week', () => {
    const oro = position('ice', ['oro']);
    const input: SolverInput = {
      slots: [slot('easy', '2026-07-06 08:00', '2026-07-06 12:00', { positionId: 'front', pos: position('front') }), slot('rare', '2026-07-06 09:00', '2026-07-06 13:00', { positionId: 'ice', pos: oro })],
      people: [
        person('both', { qualifiedPositionIds: new Set(['front', 'ice']), certExpiry: new Map([['oro', null]]), primaryPositionId: 'front' }),
        person('frontOnly', { qualifiedPositionIds: new Set(['front']), primaryPositionId: 'front', employmentStatus: 'ON_CALL' }),
      ],
      options: options({ greedyOnly: true }),
    };
    const r = solve(input);
    expect(Object.fromEntries(r.proposals.map((p) => [p.slotId, p.userId]))).toEqual({ rare: 'both', easy: 'frontOnly' });
    expect(r.proposals.find((p) => p.slotId === 'rare')!.reasons.map((x) => x.code)).toContain('ONLY_OPTION');
  });

  it('local search spreads hours more fairly than the greedy start', () => {
    let better = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const input = randomWeek(seed, 30, 70, { seed, weights: { ...DEFAULT_WEIGHTS, fairness: 10, targetHours: 0, continuity: 0, preferences: 0, spread: 0 }, maxIterations: 20000 });
      for (const p of input.people) p.targetHours = null;
      const r = solve(input);
      expect(r.summary.cost).toBeLessThanOrEqual(r.summary.greedy.cost);
      expect(r.summary.filled).toBeGreaterThanOrEqual(r.summary.greedy.filled);
      if (r.summary.hours.stdev < r.summary.greedy.stdev) better++;
      expect(r.summary.hours.stdev).toBeLessThanOrEqual(r.summary.greedy.stdev + 1e-9);
    }
    expect(better).toBeGreaterThan(0);
  });

  it('brings full-time staff up to their contracted hours first', () => {
    const r = solve({
      slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
      people: [person('casual', { employmentStatus: 'CASUAL' }), person('ft', { employmentStatus: 'FULL_TIME', targetHours: 32 })],
      options: options(),
    });
    expect(r.proposals[0]!.userId).toBe('ft');
    expect(r.proposals[0]!.reasons.map((x) => x.code)).toContain('BELOW_TARGET');
  });

  it('puts a certified operator on the slot that keeps required coverage', () => {
    const r = solve({
      slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 16:00', { facilityId: 'arena', positionId: 'front', pos: position('front') })],
      people: [person('a', { qualifiedPositionIds: new Set(['front']), primaryPositionId: 'front' }), person('oro', { qualifiedPositionIds: new Set(['front']), primaryPositionId: 'front', certExpiry: new Map([['oro', null]]) })],
      coverage: [{ id: 'c', name: 'Refrigeration operator', facilityId: 'arena', certificationId: 'oro', minCount: 1, windows: [{ start: at('2026-07-06 08:00'), end: at('2026-07-06 16:00') }] }],
      options: options(),
    });
    expect(r.proposals[0]!.userId).toBe('oro');
    expect(r.coverageGaps).toEqual([]);
  });

  it('marks shifts beyond the planning window tentative and prefers people who confirmed', () => {
    const r = solve({
      slots: [slot('later', '2026-07-08 08:00', '2026-07-08 12:00', { tentative: true })],
      people: [person('unconfirmed'), person('confirmed', { confirmedThrough: '2026-07-31' })],
      options: options(),
    });
    expect(r.proposals[0]).toMatchObject({ userId: 'confirmed', tentative: true });
    expect(r.proposals[0]!.reasons.map((x) => x.code)).toContain('CONFIRMED');
    expect(r.summary.tentative).toBe(1);
  });

  it('keeps the current draft assignee when nothing better is needed, and proposes nothing for it', () => {
    const r = solve({ slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 12:00', { currentUserId: 'b' })], people: [person('a'), person('b')], options: options() });
    expect(r.summary.filled).toBe(1);
    expect(r.proposals).toEqual([]);
  });

  it('offers the top three alternatives with their reasons', () => {
    const r = solve({ slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 12:00')], people: ['a', 'b', 'c', 'd', 'e'].map((id) => person(id)), options: options() });
    expect(r.proposals[0]!.alternatives).toHaveLength(3);
    expect(r.proposals[0]!.alternatives.every((a) => a.userId !== r.proposals[0]!.userId && a.reasons[0]!.code === 'QUALIFIED_AVAILABLE')).toBe(true);
  });
});

describe('solve: unfilled shifts', () => {
  it('says why no one could take it ("3 qualified: 2 on time off, 1 at their weekly cap")', () => {
    const off = { approvedTimeOff: [{ start: at('2026-07-06 00:00'), end: at('2026-07-07 00:00') }] };
    const r = solve({
      slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
      people: [person('a', off), person('b', off), person('c', { weeklyMaxHours: new Decimal(4) }), person('other', { qualifiedPositionIds: new Set(['front']) })],
      options: options(),
    });
    expect(r.unfilled).toEqual([{ slotId: 's1', qualified: 3, counts: [{ code: 'ON_APPROVED_TIME_OFF', count: 2 }, { code: 'OVER_PERSONAL_WEEKLY_MAX', count: 1 }], overtimeOption: null }]);
  });

  it('names who could take it with overtime when overtime is avoided', () => {
    const busy = DAYS.slice(1, 6).map((d) => ({ start: at(`${d} 08:00`), end: at(`${d} 16:00`), positionId: 'guard', facilityId: 'f1' }));
    const r = solve({ slots: [slot('sat', '2026-07-11 08:00', '2026-07-11 12:00')], people: [person('full', { existingShifts: busy })], options: options({ maxConsecutiveDays: 7 }) });
    expect(r.unfilled[0]!.overtimeOption).toEqual({ userId: 'full', overtimeHours: 4 });
    expect(r.unfilled[0]!.counts).toEqual([{ code: 'OVERTIME', count: 1 }]);
  });
});

describe('solve: seniority', () => {
  const two = (juniorFirst: boolean) => ({
    slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 16:00')],
    people: [person('x', { seniorityDate: juniorFirst ? '2024-01-01' : '2010-01-01' }), person('y', { seniorityDate: juniorFirst ? '2010-01-01' : '2024-01-01' })],
  });

  it('gives hours by seniority when the organization uses it', () => {
    expect(solve({ ...two(true), options: options({ useSeniority: true }) }).proposals[0]!.userId).toBe('y');
    expect(solve({ ...two(false), options: options({ useSeniority: true }) }).proposals[0]!.userId).toBe('x');
    expect(solve({ ...two(false), options: options({ useSeniority: true }) }).proposals[0]!.reasons.map((r) => r.code)).toContain('SENIORITY');
  });

  it('has zero influence when off: swapping seniority dates leaves the result identical', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const a = randomWeek(seed, 30, 60, { seed, useSeniority: false, maxIterations: 5000 });
      const b = randomWeek(seed, 30, 60, { seed, useSeniority: false, maxIterations: 5000 });
      // Reverse everyone's seniority.
      const dates = b.people.map((p) => [p.seniorityDate, p.seniorityHours] as const).reverse();
      b.people.forEach((p, i) => {
        p.seniorityDate = dates[i]![0];
        p.seniorityHours = dates[i]![1];
      });
      const ra = solve(a);
      const rb = solve(b);
      expect(rb.proposals).toEqual(ra.proposals);
      expect(rb.unfilled).toEqual(ra.unfilled);
      expect(JSON.stringify(ra.proposals)).not.toContain('SENIORITY');
    }
  });

  it('breaks ties by fewest hours, then a seeded order (not names)', () => {
    const r1 = solve({ slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 12:00')], people: [person('aaa'), person('zzz')], options: options({ seed: 1 }) });
    const picks = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) picks.add(solve({ slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 12:00')], people: [person('aaa'), person('zzz')], options: options({ seed }) }).proposals[0]!.userId);
    expect(picks.size).toBe(2); // the seed, not the alphabet, decides a true tie
    const busier = solve({ slots: [slot('s1', '2026-07-06 08:00', '2026-07-06 12:00')], people: [person('aaa', { prior: { hours: 10, weekends: 0, evenings: 0, weeks: 1 } }), person('zzz')], options: options({ seed: 1, weights: { ...DEFAULT_WEIGHTS, fairness: 0 } }) });
    expect(busier.proposals[0]!.userId).toBe('zzz');
    expect(r1.proposals[0]!.userId).toMatch(/aaa|zzz/);
  });
});

describe('solve: reproducible and fast', () => {
  it('gives the same answer for the same seed', () => {
    const a = solve(randomWeek(9, 40, 100, { seed: 3, maxIterations: 8000, timeBudgetMs: 20_000 }));
    const b = solve(randomWeek(9, 40, 100, { seed: 3, maxIterations: 8000, timeBudgetMs: 20_000 }));
    expect(b.proposals).toEqual(a.proposals);
    expect(b.summary.iterations).toBe(a.summary.iterations);
  });

  it('respects the time budget on a city-sized week (300 people, 600 shifts)', () => {
    const input = randomWeek(42, 300, 600, { timeBudgetMs: 1000, maxIterations: 10_000_000 });
    const r = solve(input);
    expect(r.summary.stoppedBy === 'time' || r.summary.stoppedBy === 'converged').toBe(true);
    expect(r.summary.ms).toBeLessThan(2500);
    expect(r.summary.filled / r.summary.slots).toBeGreaterThan(0.9);
  }, 20_000);
});

describe('solver settings', () => {
  it('defaults, and keeps the overtime policy’s own keys when saving', () => {
    const s = parseSolverSettings({ countRefusals: false });
    expect(s.planAheadWeeks).toBe(2);
    expect(s.weights).toEqual(DEFAULT_WEIGHTS);
    expect(withSolverSettings({ countRefusals: false, clause: 'Art. 12' }, s)).toMatchObject({ countRefusals: false, clause: 'Art. 12', solver: { planAheadWeeks: 2 } });
  });

  it('one plan-ahead setting drives the default horizon; a department can override it', () => {
    const s = parseSolverSettings({ solver: { planAheadWeeks: 4, departments: { parks: { planAheadWeeks: 1 } } } });
    expect(effectiveSettings(s, null, true)).toMatchObject({ planAheadWeeks: 4, planAheadFrom: 'organization' });
    expect(effectiveSettings(s, 'aquatics', true).planAheadWeeks).toBe(4);
    expect(effectiveSettings(s, 'parks', true)).toMatchObject({ planAheadWeeks: 1, planAheadFrom: 'department' });
  });

  it('seniority: the organization switch wins; a department can only turn it off', () => {
    const s = parseSolverSettings({ solver: { departments: { a: { useSeniority: false }, b: { useSeniority: true } } } });
    expect(effectiveSettings(s, 'a', true)).toMatchObject({ useSeniority: false, weights: { seniority: 0 } });
    expect(effectiveSettings(s, 'b', true).useSeniority).toBe(true);
    expect(effectiveSettings(s, 'b', false)).toMatchObject({ useSeniority: false, weights: { seniority: 0 } });
  });

  it('ignores invalid stored values', () => {
    const s = parseSolverSettings({ solver: { planAheadWeeks: 3, weights: { fairness: 99 }, limits: { maxConsecutiveDays: 0 } } });
    expect(s.planAheadWeeks).toBe(2);
    expect(s.weights.fairness).toBe(DEFAULT_WEIGHTS.fairness);
    expect(s.limits.maxConsecutiveDays).toBe(6);
  });
});

void RULES;

describe('solve: scheduler review fixes', () => {
  const wide = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 2880, effectiveFrom: '2026-01-01', effectiveTo: null }));
  it('never proposes a shift longer than the max hours a day, overnight included', () => {
    const r = solve({ slots: [slot('ov', '2026-07-07 16:00', '2026-07-08 08:00')], people: [person('a', { availability: wide })], options: options({ avoidOvertime: false, maxDailyHours: 12 }) });
    expect(r.summary.filled).toBe(0);
    expect(r.unfilled[0]!.counts[0]!.code).toBe('DAILY_HOURS');
  });
  it('BC: estimates overnight overtime on the 24-hour day from the shift start', () => {
    const r = solve({ slots: [slot('ov', '2026-07-07 22:00', '2026-07-08 08:00')], people: [person('a', { availability: wide })], options: options({ avoidOvertime: false }) });
    expect(r.summary.filled).toBe(1);
    expect(r.summary.overtimeHours).toBe(2);
  });
  it('BC: keeps 32 hours off in a row each pay week', () => {
    const days = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const r = solve({ slots: days.map((d, k) => slot(`e${k}`, `${d} 15:00`, `${d} 23:00`)), people: [person('a', { availability: wide })], options: options({ avoidOvertime: false }) });
    expect(r.summary.filled).toBe(5);
  });
  it('checks coverage certificates on each window’s own date', () => {
    const days = ['2026-07-08', '2026-07-09'];
    const pre = days.map((d) => ({ start: at(`${d} 08:00`), end: at(`${d} 16:00`), positionId: 'front', facilityId: 'f1' }));
    const r = solve({ slots: [], people: [person('exp', { certExpiry: new Map([['nls', '2026-07-08']]), existingShifts: pre })], coverage: [{ id: 'c', name: 'NLS', facilityId: 'f1', certificationId: 'nls', minCount: 1, windows: days.map((d) => ({ start: at(`${d} 08:00`), end: at(`${d} 16:00`) })) }], options: options() });
    expect(r.coverageGaps[0]!.shortHours).toBe(8);
  });
  it('gives hours to full-time staff before part-time, and part-time before casual', () => {
    const slots = DAYS.slice(1, 4).map((d, k) => slot(`s${k}`, `${d} 08:00`, `${d} 16:00`));
    const r = solve({ slots, people: [person('cas', { employmentStatus: 'CASUAL' }), person('pt', { employmentStatus: 'PART_TIME' }), person('ft', { employmentStatus: 'FULL_TIME', targetHours: 24 })], options: options() });
    const h = Object.fromEntries(r.people.map((p) => [p.userId, p.hours]));
    expect(h.ft).toBe(24);
    const r2 = solve({ slots: slots.slice(0, 1), people: [person('cas', { employmentStatus: 'CASUAL' }), person('pt', { employmentStatus: 'PART_TIME' })], options: options() });
    expect(r2.proposals[0]!.userId).toBe('pt');
  });
  it('rotates statutory holidays and counts their cost', () => {
    const hol = slot('hol', '2026-07-06 08:00', '2026-07-06 16:00', { statHoliday: true });
    const r = solve({ slots: [hol], people: [person('a', { prior: { hours: 0, weekends: 0, evenings: 0, weeks: 1, holidays: 2 } }), person('b', { prior: { hours: 0, weekends: 0, evenings: 0, weeks: 1, holidays: 0 } })], options: options() });
    expect(r.proposals[0]!.userId).toBe('b');
    expect(r.proposals[0]!.reasons.map((x) => x.code)).toContain('STAT_HOLIDAY');
    expect(r.people.find((p) => p.userId === 'b')!.holidays).toBe(1);
  });
  it('flags a missing date of birth on the proposal', () => {
    const r = solve({ slots: [slot('k', '2026-07-08 09:00', '2026-07-08 15:00')], people: [person('kid', { dateOfBirth: null })], options: options() });
    expect(r.proposals[0]!.reasons.map((x) => x.code)).toContain('DOB_MISSING');
  });
  it('says whether a run is reproducible (iterations, not the clock, ended it)', () => {
    const r = solve(randomWeek(3, 20, 40, { maxIterations: 500 }));
    expect(r.summary.reproducible).toBe(true);
  });
  it('matches availability in wall-clock minutes on DST days and past midnight', () => {
    const late = [{ dayOfWeek: 6, startMinute: 1320, endMinute: 1800, effectiveFrom: '2026-01-01', effectiveTo: null }];
    const r = solve({ slots: [slot('n', '2026-07-12 00:30', '2026-07-12 05:30')], people: [person('a', { availability: late })], options: options({ windowEnd: at('2026-07-13 00:00') }) });
    expect(r.summary.filled).toBe(1);
  });
});
