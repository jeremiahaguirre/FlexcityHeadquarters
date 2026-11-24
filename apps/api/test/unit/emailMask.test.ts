import { describe, expect, it } from 'vitest';
import { masked } from '../../src/services/people/emailChange.js';

describe('masked email', () => {
  it('keeps the first character and the domain', () => {
    expect(masked('someone@example.test')).toBe('s•••@example.test');
    expect(masked('a.b@c@example.test')).toBe('a•••@example.test');
    expect(masked('nodomain')).toBe('•••');
  });

  it('stays fast on input built to make a backtracking pattern slow', () => {
    // The old /^(.).*(@.*)$/ took ~350 ms on 20 000 characters here (quadratic); the trailing newline makes it fail to match.
    const evil = `a${'@'.repeat(20_000)}\n`;
    const t = performance.now();
    masked(evil);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
