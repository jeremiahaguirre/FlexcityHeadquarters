import { describe, expect, it } from 'vitest';
import { earlyOnly, householdBody, memberBody } from './programs';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('family forms', () => {
  it('blanks clear an address, emergency contact, phone, email or safety note', () => {
    expect(householdBody(form({ name: ' Okafor ', address: '', emName: 'Uncle Obi', emPhone: '' }))).toEqual({ name: 'Okafor', address: null, emergencyName: 'Uncle Obi', emergencyPhone: null });
    expect(memberBody(form({ role: 'CHILD', first: 'Ngozi', last: 'Okafor', dob: '2021-06-01', phone: '', email: '', note: ' Peanut allergy ', photoConsent: 'on' }))).toEqual({
      role: 'CHILD', firstName: 'Ngozi', lastName: 'Okafor', dateOfBirth: '2021-06-01', phone: null, email: null, safetyNote: 'Peanut allergy', photoConsent: true,
    });
  });

  it('early registration is offered only for a program that opens later, not one that closed', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(earlyOnly({ registrationOpen: false, registrationOpensAt: '2026-12-01T08:00:00Z' }, now)).toBe(true);
    expect(earlyOnly({ registrationOpen: false, registrationOpensAt: '2026-11-01T08:00:00Z' }, now)).toBe(false);
    expect(earlyOnly({ registrationOpen: false, registrationOpensAt: null }, now)).toBe(false);
    expect(earlyOnly({ registrationOpen: true, registrationOpensAt: '2026-12-01T08:00:00Z' }, now)).toBe(false);
  });
});
