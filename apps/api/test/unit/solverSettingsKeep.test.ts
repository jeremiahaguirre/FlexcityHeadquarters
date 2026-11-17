import { describe, expect, it } from 'vitest';
import { parseSolverSettings, withSolverSettings } from '../../src/services/scheduling/solverSettings.js';

// An older release writes the solver settings back without losing keys a newer one added, at
// every level the parser rebuilds (ARCHITECTURE-REVIEW A11; review of #63).
const stored = {
  countRefusals: true,
  solver: {
    futureTop: 'kept',
    planAheadWeeks: 4,
    weights: { fairness: 2, skills: 9 },
    toggles: { keepAssigned: false, futureToggle: true },
    limits: { maxConsecutiveDays: 5, futureLimit: 3 },
    departments: {
      d1: { planAheadWeeks: 2, maxWeeklyHours: 30, weights: { overtime: 1, skills: 4 }, limits: { maxDailyHours: 10, futureLimit: 7 } },
      d2: { useSeniority: false, futureFlag: 'x' },
    },
  },
};

describe('withSolverSettings keeps keys it does not know', () => {
  it('in solver, its weights, toggles and limits, and in each department and its nested objects', () => {
    const s = parseSolverSettings(stored);
    const out = withSolverSettings(stored, { ...s, lastHorizonWeeks: 2 }) as { countRefusals: boolean; solver: Record<string, any> };
    expect(out.countRefusals).toBe(true);
    expect(out.solver.futureTop).toBe('kept');
    expect(out.solver.lastHorizonWeeks).toBe(2);
    expect(out.solver.weights).toMatchObject({ fairness: 2, skills: 9 });
    expect(out.solver.toggles).toMatchObject({ keepAssigned: false, futureToggle: true });
    expect(out.solver.limits).toMatchObject({ maxConsecutiveDays: 5, futureLimit: 3 });
    expect(out.solver.departments.d1).toMatchObject({ planAheadWeeks: 2, maxWeeklyHours: 30, weights: { overtime: 1, skills: 4 }, limits: { maxDailyHours: 10, futureLimit: 7 } });
    expect(out.solver.departments.d2).toMatchObject({ useSeniority: false, futureFlag: 'x' });
  });

  it('a department reset drops its known settings and keeps only what this version does not know', () => {
    const s = parseSolverSettings(stored);
    s.departments.d1 = {};
    const out = withSolverSettings(stored, s) as { solver: Record<string, any> };
    expect(out.solver.departments.d1).toEqual({ maxWeeklyHours: 30, weights: { skills: 4 }, limits: { futureLimit: 7 } });
  });

  it('a changed known value is written, not the stored one', () => {
    const s = parseSolverSettings(stored);
    s.weights = { ...s.weights, fairness: 8 };
    const out = withSolverSettings(stored, s) as { solver: Record<string, any> };
    expect(out.solver.weights.fairness).toBe(8);
    expect(out.solver.weights.skills).toBe(9);
  });
});
