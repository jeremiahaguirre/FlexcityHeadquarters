import { describe, expect, it } from 'vitest';
import { permissionsFor } from '../../src/auth/permissions.js';
import { resolveFeatures, withoutDisabled } from '../../src/services/platform/features.js';

describe('feature switches', () => {
  it('fills in defaults and ignores unknown or malformed switches', () => {
    const f = resolveFeatures({ shiftBoard: false, union: 'yes', bogus: true });
    expect(f.shiftBoard).toBe(false);
    expect(f.union).toBe(false); // default off, and 'yes' isn't a boolean
    expect(f.timeclock).toBe(true);
    expect('bogus' in f).toBe(false);
    expect(resolveFeatures(null).payroll).toBe(true);
  });

  it('a switched-off feature takes its permissions away from every role', () => {
    const sup = permissionsFor(['AQUATIC_SUPERVISOR']);
    const out = withoutDisabled(sup, resolveFeatures({ shiftBoard: false, payroll: false }));
    expect(out.has('shiftboard.approve')).toBe(false);
    expect(out.has('payroll.export')).toBe(false);
    expect(out.has('schedule.write')).toBe(true);
  });
});
