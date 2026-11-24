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

describe('withSolverSettings and prototype pollution (ASVS 15.3.6; CodeQL on #63)', () => {
  // As the database and a request hand it over: JSON.parse makes "__proto__" an own key.
  const hostile = JSON.parse(`{
    "__proto__": { "pollutedTop": true },
    "solver": {
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "polluted": true } },
      "prototype": { "polluted": true },
      "weights": { "__proto__": { "polluted": true }, "fairness": 2 },
      "departments": { "__proto__": { "__proto__": { "polluted": true } }, "d1": { "__proto__": { "polluted": true }, "planAheadWeeks": 2 } }
    }
  }`);

  it('a stored or submitted "__proto__" changes no prototype and does not survive as a key', () => {
    const s = parseSolverSettings(hostile);
    // Reading the stored departments sets no prototype either.
    expect(Object.getPrototypeOf(s.departments)).toBe(Object.prototype);
    expect(Object.keys(s.departments)).toEqual(['d1']);
    // A submitted department keyed "__proto__", and nested keys, as a client could send them.
    const submitted = JSON.parse('{"__proto__": {"planAheadWeeks": 1}, "d1": {"planAheadWeeks": 3}}');
    const out = withSolverSettings(hostile, { ...s, departments: { ...s.departments, ...submitted } }) as Record<string, any>;
    const solver = out.solver;
    for (const o of [out, solver, solver.weights, solver.toggles, solver.limits, solver.departments, solver.departments.d1]) {
      expect(Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null).toBe(true);
      expect(Object.keys(o)).not.toContain('__proto__');
      expect(Object.keys(o)).not.toContain('constructor');
      expect(Object.keys(o)).not.toContain('prototype');
      expect((o as Record<string, unknown>).polluted).toBeUndefined();
    }
    expect(solver.weights.fairness).toBe(2);
    expect(solver.departments.d1.planAheadWeeks).toBe(3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Stored again, nothing hostile comes back.
    expect(JSON.stringify(out)).not.toMatch(/__proto__|polluted/);
  });
});
