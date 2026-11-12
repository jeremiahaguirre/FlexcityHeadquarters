import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { count, resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword } from '../../src/auth/tokens.js';
import { POLICIES, failKey, networkId, networkLockedUntil } from '../../src/auth/bruteForce.js';
import { LOGIN_FAILURES_PER_ADDRESS } from '../../src/routes/auth.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

/**
 * Sign-in limits under concurrency and as a denial of service (auth/bruteForce.ts, routes/auth.ts):
 * parallel guesses can't get past the per-network limit or lose counts; failures from one network
 * don't lock the person out of another; an office behind one address isn't throttled by its own
 * successful sign-ins; every wrong password counts toward the address block, whatever the answer.
 */
const server = createApp();
const SUB = 'srace';
const CLOSED = 'sracex';
const PASSWORD = 'tide-pool-2026!';
let t: Awaited<ReturnType<typeof seedTenant>>;
let closed: Awaited<ReturnType<typeof seedTenant>>;
const login = (email: string, password: string, from: string, sub = SUB) => request(server).post('/api/auth/login').set('x-tenant-subdomain', sub).set('X-Forwarded-For', from).send({ email, password });
const forgot = (email: string, from: string) => request(server).post('/api/auth/forgot').set('x-tenant-subdomain', SUB).set('X-Forwarded-For', from).send({ email });
const row = (email: string) => owner.user.findFirstOrThrow({ where: { tenantId: t.tenant.id, email } });

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 6);
  closed = await seedTenant(CLOSED, 1);
  const hash = await hashPassword(PASSWORD);
  await owner.user.updateMany({ where: { tenantId: { in: [t.tenant.id, closed.tenant.id] } }, data: { passwordHash: hash } });
  await owner.tenant.update({ where: { id: closed.tenant.id }, data: { disabledAt: new Date(), exportUntil: new Date(Date.now() + 30 * 86_400_000) } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('parallel guesses', () => {
  it('29 wrong and the right password in one burst from one network: the right one is refused, the network locks once', async () => {
    const email = 'guard0@srace.test';
    // Requests arrive in no set order, so the right password is sent once the wrong guesses hold the
    // network's 5 places, or have already locked it (they may still be in flight): it must be refused.
    const account = `${t.tenant.id}:${email}`;
    const a = { surface: 'org' as const, account, network: networkId('org', account, '198.51.100.200') };
    const taken = async () => (await count(failKey(a), POLICIES.org.windowMs)) >= POLICIES.org.failures || !!(await networkLockedUntil(a));
    const wrong = [];
    for (let i = 0; i < 29; i++) wrong.push(login(email, `wrong-pass-${i}`, `198.51.100.${i + 1}`).then((r) => r));
    for (let waited = 0; !(await taken()); waited += 10) {
      expect(waited, 'the wrong guesses never took the 5 places').toBeLessThan(15_000);
      await new Promise((r) => setTimeout(r, 10));
    }
    const right = await login(email, PASSWORD, '198.51.100.200');
    await Promise.all(wrong);
    expect(right.status).toBe(401);
    expect(right.body.code).toBe('INVALID_CREDENTIALS');
    // Still locked out from that network afterwards; one lock recorded.
    expect((await login(email, PASSWORD, '198.51.100.201')).status).toBe(401);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'auth.network_locked', entityId: (await row(email)).id } })).toBe(1);
  });

  it('60 wrong in parallel from 60 networks: every failure counts (no lost updates), the account locks once, one email', async () => {
    const email = 'guard1@srace.test';
    const reqs = [];
    for (let i = 0; i < 60; i++) reqs.push(login(email, `wrong-pass-${i}`, `10.${i}.7.1`));
    await Promise.all(reqs);
    const u = await row(email);
    // 50 failures lock the whole account; the 10 that arrive while it is locked don't count.
    expect(u.lockoutLevel).toBe(1);
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, toEmail: email, template: 'account_locked' } })).toBe(1);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'auth.account_locked', entityId: u.id } })).toBe(1);
  });
});

describe('lockout is not a denial of service', () => {
  it('an attacker locking a network and using up its reset links leaves the person free from their own network', async () => {
    const victim = 'guard2@srace.test';
    for (let i = 0; i < 5; i++) await login(victim, `wrong-pass-${i}`, '192.0.2.10');
    for (let i = 0; i < 3; i++) await forgot(victim.toUpperCase(), `192.0.2.${20 + i}`);
    const before = await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, toEmail: victim, template: 'password_reset' } });
    expect((await login(victim, PASSWORD, '192.0.2.99')).status).toBe(401); // the attacker's network is locked out
    expect((await login(victim, PASSWORD, '198.18.0.5')).status).toBe(200);
    await forgot(victim, '198.18.0.5');
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, toEmail: victim, template: 'password_reset' } })).toBe(before + 1);
  });

  it('reset links: 3 per network an hour, at most 10 an hour across networks, except from a network the account signed in from', async () => {
    const email = 'guard3@srace.test';
    const resets = () => owner.emailOutbox.count({ where: { tenantId: t.tenant.id, toEmail: email, template: 'password_reset' } });
    expect((await login(email, PASSWORD, '172.31.9.1')).status).toBe(200); // a known network now
    for (let n = 0; n < 5; n++) for (let i = 0; i < 3; i++) await forgot(email, `203.0.${n}.${i + 1}`);
    expect(await resets()).toBe(10);
    await forgot(email, '172.31.9.2');
    expect(await resets()).toBe(11);
  });
});

describe('per-address limits count failures only', () => {
  it('an office behind one address signs in many times; only its failures are limited', async () => {
    const ip = '100.70.0.1';
    for (let i = 0; i < LOGIN_FAILURES_PER_ADDRESS + 5; i++) expect((await login(`guard${i % 2 ? 4 : 5}@srace.test`, PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < LOGIN_FAILURES_PER_ADDRESS; i++) await login(`nobody${i % 3}@srace.test`, 'not-it-at-all-1', ip);
    expect((await login('guard4@srace.test', PASSWORD, ip)).status).toBe(429);
  });

  it('wrong passwords on a closed organization still count toward the address block', async () => {
    const ip = '100.71.0.1';
    for (let i = 0; i < 10; i++) expect((await login(`list-${i}@elsewhere.test`, 'Summer2024!', ip, CLOSED)).body.code).toBe('ORG_DISABLED');
    const blocked = await login('guard0@sracex.test', PASSWORD, ip, CLOSED);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
