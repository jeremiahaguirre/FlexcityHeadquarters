import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET ??= 'unit-test-secret-unit-test-secret-000';
process.env.APP_DATABASE_URL ??= 'postgresql://flexcity_app:x@localhost:5432/unit';
process.env.DATABASE_URL ??= 'postgresql://postgres:x@localhost:5432/unit';

const { signAccessToken, verifyAccessToken } = await import('../../src/auth/tokens.js');
const { config } = await import('../../src/config.js');

// Built by hand from the JWS spec (RFC 7515), independent of the JWT library.
const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const hs = (alg: 'sha256' | 'sha512', input: string, key: string) => createHmac(alg, key).update(input).digest('base64url');
const forge = (header: object, payload: object, key = config().JWT_SECRET, alg: 'sha256' | 'sha512' = 'sha256') => {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${hs(alg, input, key)}`;
};
const parts = (t: string) => t.split('.').map((p, i) => (i < 2 ? JSON.parse(Buffer.from(p, 'base64url').toString()) : p));

const NOW = new Date('2026-11-12T19:00:00Z');
const now = Math.floor(NOW.getTime() / 1000);
const claims = { sub: 'user-1', tid: 'tenant-1', roles: ['STAFF' as const] };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.setSystemTime(NOW));

describe('access tokens', () => {
  it('are HS256 JWTs with exactly these claims, byte for byte what the spec gives', async () => {
    const ttl = config().ACCESS_TOKEN_TTL_SECONDS;
    const t = await signAccessToken({ ...claims, aat: now - 5, mfa: true, sup: 'support-1' });
    const [header, payload] = parts(t);
    expect(header).toEqual({ alg: 'HS256' });
    expect(payload).toEqual({ tid: 'tenant-1', roles: ['STAFF'], aat: now - 5, mfa: true, sup: 'support-1', sub: 'user-1', iat: now, exp: now + ttl });
    expect(t).toBe(forge({ alg: 'HS256' }, { tid: 'tenant-1', roles: ['STAFF'], aat: now - 5, mfa: true, sup: 'support-1', sub: 'user-1', iat: now, exp: now + ttl }));
  });

  it('leave out the optional claims when they are not set, and honour a custom lifetime', async () => {
    const t = await signAccessToken(claims, 60);
    expect(parts(t)[1]).toEqual({ tid: 'tenant-1', roles: ['STAFF'], sub: 'user-1', iat: now, exp: now + 60 });
  });

  it('read back the same claims', async () => {
    expect(await verifyAccessToken(await signAccessToken({ ...claims, aat: now, mfa: true, sup: 's' }))).toEqual({ ...claims, aat: now, mfa: true, sup: 's' });
    expect(await verifyAccessToken(await signAccessToken(claims))).toEqual({ ...claims, aat: undefined, mfa: false });
  });

  it('expire at exp, with no grace period', async () => {
    const t = await signAccessToken(claims, 60);
    vi.setSystemTime(new Date(NOW.getTime() + 59_000));
    await expect(verifyAccessToken(t)).resolves.toMatchObject({ sub: 'user-1' });
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await expect(verifyAccessToken(t)).rejects.toThrow();
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
    await expect(verifyAccessToken(t)).rejects.toThrow();
  });

  it('are refused when the claims or the signature were changed', async () => {
    const t = await signAccessToken(claims);
    const [h, p, s] = t.split('.');
    const raised = b64({ ...parts(t)[1], roles: ['HR_ADMIN'] });
    await expect(verifyAccessToken(`${h}.${raised}.${s}`)).rejects.toThrow();
    const otherSig = `${s!.slice(0, -2)}${s!.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(verifyAccessToken(`${h}.${p}.${otherSig}`)).rejects.toThrow();
    await expect(verifyAccessToken(`${h}.${p}.`)).rejects.toThrow();
    await expect(verifyAccessToken(`${h}.${p}`)).rejects.toThrow();
  });

  it('are refused unsigned (alg "none"), whatever the claims say', async () => {
    const payload = { ...claims, iat: now, exp: now + 600 };
    await expect(verifyAccessToken(`${b64({ alg: 'none' })}.${b64(payload)}.`)).rejects.toThrow();
    await expect(verifyAccessToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`)).rejects.toThrow();
    await expect(verifyAccessToken(`${b64({ alg: 'None' })}.${b64(payload)}.`)).rejects.toThrow();
  });

  it('are refused when signed with another key or another algorithm', async () => {
    const payload = { ...claims, iat: now, exp: now + 600 };
    // The control: the same token signed with the real key and HS256 is accepted.
    await expect(verifyAccessToken(forge({ alg: 'HS256' }, payload))).resolves.toMatchObject(claims);
    await expect(verifyAccessToken(forge({ alg: 'HS256' }, payload, 'another-secret-another-secret-000000'))).rejects.toThrow();
    await expect(verifyAccessToken(forge({ alg: 'HS512' }, payload, config().JWT_SECRET, 'sha512'))).rejects.toThrow();
    await expect(verifyAccessToken(forge({ alg: 'HS512' }, payload, config().JWT_SECRET, 'sha256'))).rejects.toThrow();
  });

  it('are refused when a required claim is missing or has the wrong type', async () => {
    const base = { ...claims, iat: now, exp: now + 600 };
    const { tid: _t, ...noTid } = base;
    const { sub: _s, ...noSub } = base;
    await expect(verifyAccessToken(forge({ alg: 'HS256' }, noTid))).rejects.toThrow('Malformed token');
    await expect(verifyAccessToken(forge({ alg: 'HS256' }, noSub))).rejects.toThrow('Malformed token');
    await expect(verifyAccessToken(forge({ alg: 'HS256' }, { ...base, roles: 'HR' }))).rejects.toThrow('Malformed token');
  });
});
