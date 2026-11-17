import { describe, expect, it } from 'vitest';
import { profileOf, readRoleLabels } from '../../src/services/people/vocabulary.js';

const base = { chosen: null, plan: null, pools: 0, aquaticDepartments: 0, departments: 0 } as const;

describe('role vocabulary', () => {
  it('works out the profile: the choice, then private employer, pools, departments; a city being set up keeps the pool words', () => {
    expect(profileOf(base)).toBe('AQUATIC');
    expect(profileOf({ ...base, departments: 3 })).toBe('MUNICIPAL');
    expect(profileOf({ ...base, departments: 3, aquaticDepartments: 1 })).toBe('AQUATIC');
    expect(profileOf({ ...base, departments: 3, pools: 2 })).toBe('AQUATIC');
    expect(profileOf({ ...base, plan: 'CLUB', pools: 2 })).toBe('PRIVATE');
    expect(profileOf({ ...base, plan: 'CLUB', chosen: 'MUNICIPAL' })).toBe('MUNICIPAL');
  });

  it('keeps only well-formed names for known roles', () => {
    expect(readRoleLabels({ STAFF: { en: 'Team member', fr: 'Membre' }, CHIEF: { en: 'x', fr: 'y' }, FRONT_DESK: { en: 'Only English' }, EMPLOYEE: { en: ' ', fr: 'Employé' } })).toEqual({ STAFF: { en: 'Team member', fr: 'Membre' } });
    expect(readRoleLabels(null)).toEqual({});
    expect(readRoleLabels([])).toEqual({});
  });
});
