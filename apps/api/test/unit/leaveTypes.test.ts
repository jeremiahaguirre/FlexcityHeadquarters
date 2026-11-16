import { describe, expect, it } from 'vitest';
import { computeReliability } from '../../src/services/reliability/score.js';
import { SYSTEM_DEFAULTS, SYSTEM_TYPES, chainOf } from '../../src/services/people/leaveTypes.js';

describe('leave types', () => {
  it('the built-in kinds keep the old rules: sick and protected leave are the protected ones, nothing has an approval chain', () => {
    expect(SYSTEM_TYPES).toEqual(['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER', 'LIEU']);
    expect(SYSTEM_TYPES.filter((s) => SYSTEM_DEFAULTS[s].protectedLeave)).toEqual(['SICK', 'PROTECTED_LEAVE']);
    // Balances list the five built-in kinds as before; time in lieu has its own bank.
    expect(SYSTEM_TYPES.filter((s) => SYSTEM_DEFAULTS[s].hasBalance)).toEqual(['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER']);
  });

  it('reads an approval chain, ignoring anything that isn’t a step', () => {
    expect(chainOf({ approvalChain: ['MANAGER', 'HR'] })).toEqual(['MANAGER', 'HR']);
    expect(chainOf({ approvalChain: ['HR', 'BOSS', 3] })).toEqual(['HR']);
    expect(chainOf({ approvalChain: null })).toEqual([]);
  });

  it('reliability: an absence during the organization’s own protected leave doesn’t count, as during sick leave', () => {
    const now = new Date('2027-05-20T12:00:00Z');
    const ev = { id: 'n', type: 'NO_SHOW' as const, occurredAt: new Date('2027-05-10T16:00:00Z'), excludedReason: null };
    const leave = { status: 'APPROVED' as const, startsAt: new Date('2027-05-10T00:00:00Z'), endsAt: new Date('2027-05-11T00:00:00Z') };
    expect(computeReliability([ev], [{ ...leave, type: 'OTHER' }], now).score).toBeLessThan(100);
    expect(computeReliability([ev], [{ ...leave, type: 'OTHER', protectedLeave: true }], now).score).toBe(100);
    expect(computeReliability([ev], [{ ...leave, type: 'SICK' }], now).score).toBe(100);
  });
});
