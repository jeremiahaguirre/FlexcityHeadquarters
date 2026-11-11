import { describe, expect, it } from 'vitest';
import { type Person, ageClass, canReach, directSafe, groupSafe, majorityFor, readMessagingSettings } from '../../src/services/messaging/policy.js';

const p = (id: string, x: Partial<Person> = {}): Person => ({ id, name: id, roles: ['STAFF'], departmentIds: ['d1'], managesDepartmentIds: [], reportsToId: null, age: 'adult', active: true, ...x });
const ctx = { hasDepartments: true };
const on = { staffDirect: true };

describe('who can reach whom', () => {
  it('staff: their department while staff direct messages are on; leads and HR always', () => {
    expect(canReach(p('a'), p('b'), ctx, on)).toBe(true);
    expect(canReach(p('a'), p('b'), ctx, { staffDirect: false })).toBe(false);
    expect(canReach(p('a'), p('b', { departmentIds: ['d2'] }), ctx, on)).toBe(false);
    expect(canReach(p('a'), p('hr', { roles: ['HR_ADMIN'], departmentIds: [] }), ctx, { staffDirect: false })).toBe(true);
    expect(canReach(p('a', { reportsToId: 'm' }), p('m', { departmentIds: [] }), ctx, { staffDirect: false })).toBe(true);
    expect(canReach(p('m', { departmentIds: [], managesDepartmentIds: ['d1'] }), p('a'), ctx, { staffDirect: false })).toBe(true);
    expect(canReach(p('s', { roles: ['AQUATIC_SUPERVISOR'] }), p('a'), ctx, { staffDirect: false })).toBe(true);
    expect(canReach(p('s', { roles: ['AQUATIC_SUPERVISOR'], departmentIds: ['d2'] }), p('a'), ctx, on)).toBe(false);
  });
  it('no departments yet: one department; never yourself or someone inactive', () => {
    expect(canReach(p('a', { departmentIds: [] }), p('b', { departmentIds: [] }), { hasDepartments: false }, on)).toBe(true);
    expect(canReach(p('a'), p('a'), ctx, on)).toBe(false);
    expect(canReach(p('a'), p('b', { active: false }), ctx, on)).toBe(false);
  });
});

describe('rule of two', () => {
  it('minors: by the age of majority, unknown counts as possibly a minor', () => {
    const today = '2026-11-11';
    expect(ageClass(new Date('2008-11-11'), 18, today)).toBe('adult');
    expect(ageClass(new Date('2008-11-12'), 18, today)).toBe('minor');
    expect(ageClass(new Date('2008-11-11'), 19, today)).toBe('minor');
    expect(ageClass(null, 18, today)).toBe('unknown');
    expect(majorityFor(['ON', 'BC'])).toBe(19);
    expect(majorityFor(['ON', 'QC'])).toBe(18);
    expect(majorityFor([])).toBe(19);
  });
  it('one to one: adults together; minors together if allowed; never mixed or unknown', () => {
    expect(directSafe('adult', 'adult', { minorDirect: false })).toBe(true);
    expect(directSafe('minor', 'minor', { minorDirect: true })).toBe(true);
    expect(directSafe('minor', 'minor', { minorDirect: false })).toBe(false);
    expect(directSafe('adult', 'minor', { minorDirect: true })).toBe(false);
    expect(directSafe('minor', 'adult', { minorDirect: true })).toBe(false);
    expect(directSafe('adult', 'unknown', { minorDirect: true })).toBe(false);
    expect(directSafe('unknown', 'unknown', { minorDirect: true })).toBe(false);
  });
  it('groups with a minor or an unknown age need two adults', () => {
    expect(groupSafe(['adult', 'adult', 'adult'])).toBe(true);
    expect(groupSafe(['adult', 'minor', 'minor'])).toBe(false);
    expect(groupSafe(['adult', 'adult', 'minor'])).toBe(true);
    expect(groupSafe(['adult', 'unknown'])).toBe(false);
  });
  it('settings fall back to safe defaults', () => {
    expect(readMessagingSettings({ staffDirect: false, shiftArchiveHours: 9999 })).toEqual({ staffDirect: false, minorDirect: true, pushPreview: false, shiftArchiveHours: 12 });
    expect(readMessagingSettings(null).pushPreview).toBe(false);
  });
});
