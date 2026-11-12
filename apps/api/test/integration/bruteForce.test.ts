import request from 'supertest';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword } from '../../src/auth/tokens.js';
import { authFailures, authIpBlocks, authLockouts } from '../../src/lib/metrics.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

/**
 * Brute-force and credential-stuffing defences (auth/bruteForce.ts, lib/ipRateLimit.ts). Each test
 * signs in from its own address (X-Forwarded-For; the app trusts one proxy), so the per-address
 * controls of one test don't touch another.
 */
const server = createApp();
const SUB = 'brute';
const CLOSED = 'brutex';
const PASSWORD = 'tide-pool-2026!';
let t: Awaited<ReturnType<typeof seedTenant>>;
let closed: Awaited<ReturnType<typeof seedTenant>>;
let net = 10;
const freshIp = () => `203.0.113.${net++}`;
const login = (email: string, password: string, ip: string, sub = SUB) => request(server).post('/api/auth/login').set('x-tenant-subdomain', sub).set('X-Forwarded-For', ip).send({ email, password });
const shape = (r: request.Response) => ({ status: r.status, keys: Object.keys(r.body).filter((k) => k !== 'requestId').sort(), code: r.body.code, message: r.body.message });

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 4);
  closed = await seedTenant(CLOSED, 1);
  const hash = await hashPassword(PASSWORD);
  await owner.user.updateMany({ where: { tenantId: { in: [t.tenant.id, closed.tenant.id] } }, data: { passwordHash: hash } });
  await owner.user.update({ where: { id: t.users[1]!.id }, data: { locale: 'fr-CA' } });
  await owner.user.update({ where: { id: closed.users[0]!.id }, data: { roles: ['HR_ADMIN'] } });
  await owner.tenant.update({ where: { id: closed.tenant.id }, data: { disabledAt: new Date(), exportUntil: new Date(Date.now() + 30 * 86_400_000) } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('sign-in answers never tell accounts apart', () => {
  it('unknown email, wrong password and a locked account get the same answer', async () => {
    const ip = freshIp();
    const unknown = await login('nobody@brute.test', 'whatever-123', ip);
    const wrong = await login('guard0@brute.test', 'not-the-password-1', ip);
    for (let i = 0; i < 4; i++) await login('guard0@brute.test', 'not-the-password-1', ip);
    const lockedRight = await login('guard0@brute.test', PASSWORD, ip);
    expect(shape(unknown)).toEqual(shape(wrong));
    expect(shape(lockedRight)).toEqual(shape(wrong));
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(authFailures.get({ surface: 'org', reason: 'locked' })).toBeGreaterThan(0);
  });

  it('a closed organization answers the same for an unknown email and an administrator’s wrong password', async () => {
    const ip = freshIp();
    const unknown = await login('nobody@brutex.test', 'whatever-123', ip, CLOSED);
    const adminWrong = await login('guard0@brutex.test', 'not-the-password-1', ip, CLOSED);
    expect(shape(unknown)).toEqual(shape(adminWrong));
    expect(unknown.body.code).toBe('ORG_DISABLED');
    const adminRight = await login('guard0@brutex.test', PASSWORD, ip, CLOSED);
    expect(adminRight.body).toHaveProperty('accessToken');
  });

  it('forgot-password answers 202 either way, taking at least the same floor', async () => {
    const forgot = (email: string) => request(server).post('/api/auth/forgot').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', freshIp()).send({ email });
    const t0 = Date.now();
    const known = await forgot('guard3@brute.test');
    const t1 = Date.now();
    const unknown = await forgot('nobody@brute.test');
    const t2 = Date.now();
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(known.body).toEqual(unknown.body);
    expect(t1 - t0).toBeGreaterThanOrEqual(145);
    expect(t2 - t1).toBeGreaterThanOrEqual(145);
  });
});

describe('progressive account lockout', () => {
  it('5 wrong → 15 min, then doubling within 24 h; one email per lock; success resets', async () => {
    const u = t.users[1]!; // French
    const email = 'guard1@brute.test';
    const lockedBefore = authLockouts.get({ surface: 'org' });
    for (let i = 0; i < 5; i++) expect((await login(email, 'wrong-password-1', freshIp())).status).toBe(401);
    let row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockoutLevel).toBe(1);
    const first = row.lockedUntil!.getTime() - Date.now();
    expect(first).toBeGreaterThan(14 * 60_000);
    expect(first).toBeLessThanOrEqual(15 * 60_000);
    expect(authLockouts.get({ surface: 'org' })).toBe(lockedBefore + 1);

    // Attempts while locked change nothing and send nothing more.
    for (let i = 0; i < 3; i++) await login(email, 'wrong-password-1', freshIp());
    expect(await owner.emailOutbox.count({ where: { toEmail: email, template: 'account_locked' } })).toBe(1);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: email, template: 'account_locked' } });
    expect(mail.locale).toBe('fr-CA');
    expect((mail.params as { url: string }).url).toBe('http://brute.localhost:3000/forgot');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'auth.account_locked', entityId: u.id } })).toBe(1);

    // The lock passes; five more wrong passwords lock for twice as long.
    await owner.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    for (let i = 0; i < 5; i++) await login(email, 'wrong-password-1', freshIp());
    row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockoutLevel).toBe(2);
    expect(row.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(await owner.emailOutbox.count({ where: { toEmail: email, template: 'account_locked' } })).toBe(2);

    // Capped at 24 hours.
    await owner.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000), lockoutLevel: 9 } });
    for (let i = 0; i < 5; i++) await login(email, 'wrong-password-1', freshIp());
    row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    expect(row.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);

    // Once it passes, the right password signs in and starts over.
    await owner.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login(email, PASSWORD, freshIp())).status).toBe(200);
    row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect([row.failedLoginCount, row.lockoutLevel, row.lockedUntil]).toEqual([0, 0, null]);
  });

  it('failures older than the window are forgotten', async () => {
    const u = t.users[2]!;
    await owner.user.update({ where: { id: u.id }, data: { failedLoginCount: 4, lastFailedLoginAt: new Date(Date.now() - 25 * 3_600_000) } });
    await login('guard2@brute.test', 'wrong-password-1', freshIp());
    const row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.failedLoginCount).toBe(1);
    expect(row.lockedUntil).toBeNull();
  });
});

describe('credential stuffing: one address, many accounts', () => {
  it('failing on 10 different accounts in 15 minutes blocks the address from signing in for an hour', async () => {
    const ip = freshIp();
    const blocksBefore = authIpBlocks.get({ surface: 'org' });
    for (let i = 0; i < 10; i++) expect((await login(`list-${i}@elsewhere.test`, 'Summer2024!', ip)).status).toBe(401);
    // Even the right password for a real account is refused from there now…
    const blocked = await login('guard3@brute.test', PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(authIpBlocks.get({ surface: 'org' })).toBe(blocksBefore + 1);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'auth.ip_blocked' } })).toBe(1);
    // …while other addresses sign in as usual.
    expect((await login('guard3@brute.test', PASSWORD, freshIp())).status).toBe(200);
  });

  it('the same account failing repeatedly from one address doesn’t count as many accounts', async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) await login('repeat@elsewhere.test', `guess-${i}-abc`, ip);
    for (let i = 0; i < 4; i++) await login('REPEAT@elsewhere.test', `guess-${i}-abc`, ip);
    expect((await login('guard3@brute.test', PASSWORD, ip)).status).toBe(200);
  });
});

describe('Dev console: stricter', () => {
  it('an address failing on 3 different emails is blocked', async () => {
    const ip = freshIp();
    const email = `brute-${net}@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'B', passwordHash: await hashPassword(PASSWORD) } });
    const attempt = (e: string, p: string) => request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').set('X-Forwarded-For', ip).send({ email: e, password: p });
    for (let i = 0; i < 3; i++) expect((await attempt(`x${i}@flexcity.dev`, 'nope-nope-1')).status).toBe(401);
    expect((await attempt(email, PASSWORD)).status).toBe(429);
    expect(authIpBlocks.get({ surface: 'platform' })).toBeGreaterThan(0);
  });
});

describe('global per-address limit', () => {
  it('429 with Retry-After past the anonymous budget; health checks exempt; a credential gets a bigger budget until its failures run out', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { GLOBAL_RATE_LIMIT: 'on', GLOBAL_RATE_LIMIT_ANON: '5', GLOBAL_RATE_LIMIT_AUTH: '50', GLOBAL_RATE_LIMIT_FAILURES: '3' });
    try {
      const limited = createApp();
      const ip = '198.51.100.200';
      for (let i = 0; i < 5; i++) expect((await request(limited).get('/api/public/tenant').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', ip)).status).toBe(200);
      const over = await request(limited).get('/api/public/tenant').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', ip);
      expect(over.status).toBe(429);
      expect(over.body.code).toBe('RATE_LIMITED');
      expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect((await request(limited).get('/healthz').set('X-Forwarded-For', ip)).status).toBe(200);
      // Another address is unaffected.
      expect((await request(limited).get('/api/public/tenant').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', '198.51.100.201')).status).toBe(200);
      // A (bad) credential: its own bucket, but each 401 spends the failure budget.
      const bad = () => request(limited).get('/api/me').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', ip).auth('not-a-token', { type: 'bearer' });
      for (let i = 0; i < 3; i++) expect((await bad()).status).toBe(401);
      expect((await bad()).status).toBe(429);
    } finally {
      for (const k of ['GLOBAL_RATE_LIMIT', 'GLOBAL_RATE_LIMIT_ANON', 'GLOBAL_RATE_LIMIT_AUTH', 'GLOBAL_RATE_LIMIT_FAILURES']) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

describe('breached-password check (off by default; HIBP mocked, never called for real)', () => {
  it('when on, a reset to a breached password is refused with PASSWORD_BREACHED and the link still works', async () => {
    await request(server).post('/api/auth/forgot').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', freshIp()).send({ email: 'guard3@brute.test' });
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'guard3@brute.test', template: 'password_reset' }, orderBy: { createdAt: 'desc' } });
    const token = new URL((mail.params as { url: string }).url).searchParams.get('token')!;
    const breached = 'Kelowna-summer-2026';
    const sha1 = createHash('sha1').update(breached).digest('hex').toUpperCase();
    const fake = vi.fn(async (url: string) => ({ ok: true, text: async () => (url.endsWith(sha1.slice(0, 5)) ? `${sha1.slice(5)}:57\r\n${'0'.repeat(35)}:0` : '') }));
    const reset = (password: string) => request(server).post('/api/auth/reset').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', freshIp()).send({ token, password });
    vi.stubGlobal('fetch', fake);
    process.env.PASSWORD_BREACH_CHECK = 'on';
    try {
      const r = await reset(breached);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('PASSWORD_BREACHED');
      expect(fake).toHaveBeenCalledTimes(1);
      expect(fake.mock.calls[0]![0]).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
      expect((await reset('quiet-harbour-trail-88')).status).toBe(200);
    } finally {
      delete process.env.PASSWORD_BREACH_CHECK;
      vi.unstubAllGlobals();
    }
  });

  it('is off by default: no outside call', async () => {
    const fake = vi.fn();
    vi.stubGlobal('fetch', fake);
    try {
      await request(server).post('/api/auth/reset').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', freshIp()).send({ token: 'x'.repeat(43), password: 'quiet-harbour-trail-99' });
      expect(fake).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
