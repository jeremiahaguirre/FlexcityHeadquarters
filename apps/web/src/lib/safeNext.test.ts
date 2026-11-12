import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

const origin = 'https://kelowna.flexcityhq.ca';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/export', '/', origin)).toBe('/export');
    expect(safeNext('/manage/staff?id=1#notes', '/', origin)).toBe('/manage/staff?id=1#notes');
  });
  it('falls back for anything that would leave the site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\\/evil.example', '/\t/evil.example', '/\n/evil.example', '/\r//evil.example', 'https://evil.example/', 'javascript:alert(1)', 'evil.example', '', null, undefined]) {
      expect(safeNext(bad, '/', origin), JSON.stringify(bad)).toBe('/');
    }
  });
});
