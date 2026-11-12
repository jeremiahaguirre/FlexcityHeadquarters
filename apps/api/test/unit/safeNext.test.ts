import { describe, expect, it } from 'vitest';
import { safeNext } from '../../src/lib/safeNext.js';

describe('safeNext (where to go after signing in)', () => {
  it('keeps paths on this site, with their query and fragment', () => {
    expect(safeNext('/export')).toBe('/export');
    expect(safeNext('/manage/staff?id=1#x')).toBe('/manage/staff?id=1#x');
  });
  it('refuses anything a browser would read as another site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\\/evil.example', '/\t/evil.example', '/\n/evil.example', '/\r//evil.example', '\\\\evil.example', 'https://evil.example', 'evil.example', '/%0a', '', 'javascript:alert(1)', `/${'a'.repeat(400)}`]) {
      const out = safeNext(bad);
      if (out !== undefined) expect(new URL(out, 'https://kelowna.example').origin, JSON.stringify(bad)).toBe('https://kelowna.example');
      if (/[\\\t\n\r]|^\/\/|^[a-z]/i.test(bad)) expect(out, JSON.stringify(bad)).toBeUndefined();
    }
    expect(safeNext(42)).toBeUndefined();
  });
});
