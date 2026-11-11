import { describe, expect, it } from 'vitest';
import { isPersonalPassword } from '../../src/auth/commonPasswords.js';
import { passwordRule } from '../../src/routes/auth.js';

const ok = (p: string) => passwordRule.safeParse(p).success;

describe('password rules', () => {
  it('needs 12 characters, letters with numbers or symbols, and some variety', () => {
    expect(ok('river-otter-paddle-42')).toBe(true);
    expect(ok('Short-pass1')).toBe(false); // 11
    expect(ok('onlyletterslong')).toBe(false);
    expect(ok('123456789012345')).toBe(false);
    expect(ok('aaaa1111aaaa')).toBe(false); // two different characters
    expect(ok('x'.repeat(130) + '1')).toBe(false); // over 128
  });

  it('refuses common passwords with numbers or symbols bolted on', () => {
    expect(ok('Password2026!')).toBe(false);
    expect(ok('lifeguard!!!2026')).toBe(false);
    expect(ok('qwertyuiop12')).toBe(false);
  });

  it('refuses the person’s own details or the organization’s name, ignoring accents and case', () => {
    const me = { email: 'jeremie.tremblay@kelowna.ca', firstName: 'Jérémie', lastName: 'Tremblay', organization: 'City of Kelowna', subdomain: 'kelowna' };
    expect(isPersonalPassword('JEREMIE-rocks-2026', me)).toBe(true);
    expect(isPersonalPassword('blue-tremblay-77', me)).toBe(true);
    expect(isPersonalPassword('Kelowna!Summer9', me)).toBe(true);
    expect(isPersonalPassword('jeremietremblay#1', me)).toBe(true); // the email name
    // "City" and "of" are not the organization's name.
    expect(isPersonalPassword('city-of-rivers-42', me)).toBe(false);
    expect(isPersonalPassword('river-otter-paddle-42', me)).toBe(false);
    // Two-letter names don't block ordinary words.
    expect(isPersonalPassword('jo-anne-paddle-42', { firstName: 'Jo', lastName: 'Li' })).toBe(false);
  });
});
