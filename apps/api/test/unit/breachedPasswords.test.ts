import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIBP_RANGE_URL, breachCount, refuseBreached } from '../../src/auth/breachedPasswords.js';

/** Never calls the real HIBP: every test hands in its own fetch. */
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();
const PW = 'correct horse battery staple';
const answer = (lines: string[]) => vi.fn(async () => ({ ok: true, text: async () => lines.join('\r\n') }));

afterEach(() => {
  delete process.env.PASSWORD_BREACH_CHECK;
  vi.unstubAllGlobals();
});

describe('breached-password check (HIBP range API, k-anonymity)', () => {
  it('sends only the first 5 characters of the SHA-1, with padding, and matches the suffix here', async () => {
    const h = sha1(PW);
    const f = answer([`${'0'.repeat(35)}:0`, `${h.slice(5)}:4210`, `${'F'.repeat(35)}:0`]);
    expect(await breachCount(PW, f)).toBe(4210);
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; signal: AbortSignal }];
    expect(url).toBe(`${HIBP_RANGE_URL}${h.slice(0, 5)}`);
    expect(url).not.toContain(h.slice(5));
    expect(url).not.toContain(PW);
    expect(init.headers['Add-Padding']).toBe('true');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('padding lines (count 0) and other suffixes don’t count', async () => {
    expect(await breachCount(PW, answer([`${sha1(PW).slice(5)}:0`, `${'A'.repeat(35)}:12`]))).toBe(0);
  });

  it('fails open on errors, timeouts and bad answers', async () => {
    expect(await breachCount(PW, vi.fn(async () => { throw new Error('network'); }))).toBe(0);
    expect(await breachCount(PW, vi.fn(async () => ({ ok: false, text: async () => '' })))).toBe(0);
    const hang = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise<never>((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    // A provider that never answers: given up after 2 s, and the password passes.
    const t0 = Date.now();
    expect(await breachCount(PW, hang as never)).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('is off by default: no call at all', async () => {
    const f = answer([`${sha1(PW).slice(5)}:99`]);
    const global = vi.fn();
    vi.stubGlobal('fetch', global);
    await expect(refuseBreached(PW, f)).resolves.toBeUndefined();
    await expect(refuseBreached(PW)).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it('when on, refuses a breached password with PASSWORD_BREACHED', async () => {
    process.env.PASSWORD_BREACH_CHECK = 'on';
    await expect(refuseBreached(PW, answer([`${sha1(PW).slice(5)}:3`]))).rejects.toMatchObject({ status: 400, code: 'PASSWORD_BREACHED' });
    await expect(refuseBreached(PW, answer([]))).resolves.toBeUndefined();
  });
});
