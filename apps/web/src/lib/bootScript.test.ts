import { describe, expect, it } from 'vitest';
import { BOOT_SCRIPT } from './bootScript';

describe('boot script', () => {
  it('is plain script text that runs', () => {
    expect(typeof BOOT_SCRIPT).toBe('string');
    const el = { dataset: {} as Record<string, string> };
    const store = (v: string | null) => ({ getItem: () => v });
    new Function('document', 'localStorage', 'sessionStorage', BOOT_SCRIPT)({ documentElement: el }, store('dark'), store('1'));
    expect(el.dataset).toEqual({ theme: 'dark', logoSeen: '1' });
  });
});
