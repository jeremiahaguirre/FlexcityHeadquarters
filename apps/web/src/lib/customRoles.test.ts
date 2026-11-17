import { describe, expect, it } from 'vitest';
import { neededBy, toggleCapability } from './customRoles';

const needs = { 'roles.manage': ['users.read'], 'grievances.manage': ['users.read'] };
const all = () => true;

describe('role editor: capabilities that need another', () => {
  it('ticking one ticks what it needs, when the editor may give it', () => {
    expect([...toggleCapability(new Set(), 'roles.manage', needs, all)].sort()).toEqual(['roles.manage', 'users.read']);
    expect([...toggleCapability(new Set(), 'roles.manage', needs, (p) => p !== 'users.read')]).toEqual(['roles.manage']);
  });

  it('what a ticked capability needs can’t be unticked until that one is', () => {
    const both = new Set(['roles.manage', 'users.read']);
    expect(neededBy(both, 'users.read', needs)).toEqual(['roles.manage']);
    expect(toggleCapability(both, 'users.read', needs, all).has('users.read')).toBe(true);
    const without = toggleCapability(both, 'roles.manage', needs, all);
    expect([...without]).toEqual(['users.read']);
    expect(toggleCapability(without, 'users.read', needs, all).size).toBe(0);
  });
});
