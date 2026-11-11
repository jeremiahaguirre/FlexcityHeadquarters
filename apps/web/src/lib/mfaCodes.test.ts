import { describe, expect, it } from 'vitest';
import { normalizeCode } from './mfaCodes';

describe('sign-in code input', () => {
  it('keeps digits only, up to six', () => {
    expect(normalizeCode('123456')).toBe('123456');
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
    expect(normalizeCode(' 12a3 ')).toBe('123');
    expect(normalizeCode('1234567')).toBe('123456');
  });

  it('finds the code in a pasted message', () => {
    expect(normalizeCode('FlexcityHeadquarters: 042067 is your sign-in code. It expires in 10 minutes.')).toBe('042067');
    expect(normalizeCode('Your code is 042 067 (10 minutes)')).toBe('042067');
  });
});
