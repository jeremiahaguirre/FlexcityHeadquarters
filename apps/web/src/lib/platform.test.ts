import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdownload, platformHeaders } from './platform';

afterEach(() => vi.unstubAllGlobals());

describe('Dev console requests', () => {
  it('send the console header, and echo the fh_csrf token when the browser has it', () => {
    vi.stubGlobal('document', { cookie: 'fc_locale=en-CA; fh_csrf=tok%2Den' });
    expect(platformHeaders()).toEqual({ 'x-fh-platform': '1', 'x-fh-csrf': 'tok-en' });
    vi.stubGlobal('document', { cookie: '' });
    expect(platformHeaders()).toEqual({ 'x-fh-platform': '1' });
  });

  it('downloads only from this site’s console API, whatever the path holds', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example.test' } });
    vi.stubGlobal('document', { cookie: '' });
    const fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not found', json: async () => ({ code: 'NOT_FOUND' }) }));
    vi.stubGlobal('fetch', fetch);
    for (const bad of ['/../users/me', '/..%2F..%2Fx', '\\\\evil.example/x', '@evil.example/x']) {
      await expect(pdownload(bad, 'x.csv'), bad).rejects.toMatchObject({ status: expect.any(Number) });
    }
    const called = fetch.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(called.every((u) => u.startsWith('/api/platform/'))).toBe(true);
    await expect(pdownload('/books/journal.csv?from=2026-01-01&to=2026-01-31', 'j.csv')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(String((fetch.mock.calls.at(-1) as unknown[])[0])).toBe('/api/platform/books/journal.csv?from=2026-01-01&to=2026-01-31');
  });
});
