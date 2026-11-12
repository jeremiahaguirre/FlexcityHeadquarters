import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICIES, accountRule, afterFailure, beginAttempt, failedAttempt, ipBlocked, isKnownNetwork, lockDuration, networkId, networkLockedUntil, noteFailure, rememberNetwork, succeededAttempt } from '../../src/auth/bruteForce.js';
import { addressKey, networkKey } from '../../src/lib/address.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { weakPin } from '../../src/routes/kiosk.js';
import { renderEmail } from '../../src/services/notifications/mailer.js';

process.env.RATE_LIMIT_STORE = 'memory';
const MIN = 60_000;
const org = POLICIES.org;
const fresh = { failedCount: 0, lastFailedAt: null, lockLevel: 0, lastLockedAt: null };

describe('progressive lockout', () => {
  it('locks on the fifth failure for 15 minutes, doubling per lock within 24 h, capped at 24 h', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => lockDuration(l, org) / MIN)).toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440]);
    const now = new Date('2026-11-12T12:00:00Z');
    let s = { ...fresh } as Parameters<typeof afterFailure>[0];
    for (let i = 1; i <= 4; i++) {
      const r = afterFailure(s, org, now);
      expect(r.lockedUntil).toBeNull();
      expect(r.failedCount).toBe(i);
      s = { failedCount: r.failedCount, lastFailedAt: r.lastFailedAt, lockLevel: r.lockLevel, lastLockedAt: r.lastLockedAt };
    }
    const lock = afterFailure(s, org, now);
    expect(lock.lockedUntil!.getTime() - now.getTime()).toBe(15 * MIN);
    expect([lock.failedCount, lock.lockLevel]).toEqual([0, 1]);
    // Five more an hour later: level 2, 30 minutes.
    const later = new Date(now.getTime() + 60 * MIN);
    const again = afterFailure({ failedCount: 4, lastFailedAt: later, lockLevel: 1, lastLockedAt: now }, org, later);
    expect(again.lockLevel).toBe(2);
    expect(again.lockedUntil!.getTime() - later.getTime()).toBe(30 * MIN);
    // A lock more than 24 h after the last starts over at 15 minutes.
    const nextDay = new Date(now.getTime() + 25 * 60 * MIN);
    expect(afterFailure({ failedCount: 4, lastFailedAt: nextDay, lockLevel: 5, lastLockedAt: now }, org, nextDay).lockLevel).toBe(1);
  });

  it('forgets failures older than the window', () => {
    const now = new Date();
    const r = afterFailure({ failedCount: 4, lastFailedAt: new Date(now.getTime() - 25 * 60 * MIN), lockLevel: 0, lastLockedAt: null }, org, now);
    expect([r.failedCount, r.lockedUntil]).toEqual([1, null]);
  });

  it('the Dev console is stricter: 3 failures, 30 minutes first', () => {
    const p = POLICIES.platform;
    const now = new Date();
    expect(afterFailure({ failedCount: 1, lastFailedAt: now, lockLevel: 0, lastLockedAt: null }, p, now).lockedUntil).toBeNull();
    expect(afterFailure({ failedCount: 2, lastFailedAt: now, lockLevel: 0, lastLockedAt: null }, p, now).lockedUntil!.getTime() - now.getTime()).toBe(30 * MIN);
  });
});

describe('one address, many accounts', () => {
  beforeEach(() => resetLimits());
  it('blocks the address once, on the 10th different account; repeats of one account don’t count', async () => {
    for (let i = 0; i < 20; i++) expect(await noteFailure('org', '192.0.2.1', 'same@x.test')).toBe(false);
    expect(await ipBlocked('org', '192.0.2.1')).toBe(false);
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await noteFailure('org', '192.0.2.1', `a${i}@x.test`));
    // 'same' plus a0..a8 = 10 accounts: the 9th new one blocks; only once.
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.indexOf(true)).toBe(8);
    expect(await ipBlocked('org', '192.0.2.1')).toBe(true);
    expect(await ipBlocked('org', '192.0.2.10')).toBe(false);
    expect(await ipBlocked('platform', '192.0.2.1')).toBe(false);
  });
  it('an email in different case is the same account', async () => {
    for (const e of ['A@x.test', 'a@x.test', 'a@X.TEST']) await noteFailure('platform', '192.0.2.2', e);
    expect(await ipBlocked('platform', '192.0.2.2')).toBe(false);
  });
});

describe('per-network lockout', () => {
  beforeEach(() => {
    resetLimits();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  const none = { lockedUntil: null, knownNetworks: [] as string[] };
  const fail = async (ip: string, account = 't:a@x.test') => {
    const a = await beginAttempt('org', account, ip, none);
    if (!a.refused) await failedAttempt(a);
    return a;
  };

  it('5 failures from a /24 lock only that network, 15 min doubling within 24 h; a success there starts over', async () => {
    for (let i = 0; i < 5; i++) expect((await fail(`192.0.2.${i + 1}`)).refused).toBeNull();
    expect((await fail('192.0.2.200')).refused).toBe('network');
    expect((await beginAttempt('org', 't:a@x.test', '192.0.3.1', none)).refused).toBeNull();
    expect((await beginAttempt('org', 't:b@x.test', '192.0.2.1', none)).refused).toBeNull();
    const net = { surface: 'org' as const, account: 't:a@x.test', network: networkId('org', 't:a@x.test', '192.0.2.9') };
    expect((await networkLockedUntil(net))!.getTime() - Date.now()).toBe(15 * MIN);
    vi.setSystemTime(Date.now() + 16 * MIN);
    expect(await networkLockedUntil(net)).toBeNull();
    for (let i = 0; i < 5; i++) await fail('192.0.2.7');
    expect((await networkLockedUntil(net))!.getTime() - Date.now()).toBe(30 * MIN);
    vi.setSystemTime(Date.now() + 31 * MIN);
    const ok = await beginAttempt('org', 't:a@x.test', '192.0.2.7', none);
    await succeededAttempt(ok);
    for (let i = 0; i < 5; i++) await fail('192.0.2.7');
    expect((await networkLockedUntil(net))!.getTime() - Date.now()).toBe(15 * MIN);
  });

  it('a reservation counts before the password check, so parallel attempts stop at the limit', async () => {
    const all = await Promise.all(Array.from({ length: 12 }, () => beginAttempt('org', 't:c@x.test', '198.51.100.1', none)));
    expect(all.filter((a) => !a.refused)).toHaveLength(5);
    // The right password gives its place back.
    await succeededAttempt(all[0]!);
    expect((await beginAttempt('org', 't:c@x.test', '198.51.100.1', none)).refused).toBeNull();
  });

  it('a whole-account lock refuses unknown networks, not known ones; known networks expire after 30 days and only 5 are kept', async () => {
    const id = (ip: string) => networkId('org', 't:d@x.test', ip);
    let known: string[] = [];
    for (let i = 1; i <= 7; i++) known = rememberNetwork(known, id(`10.0.${i}.1`), POLICIES.org);
    expect(known).toHaveLength(5);
    expect(isKnownNetwork(known, id('10.0.7.9'), POLICIES.org)).toBe(true);
    expect(isKnownNetwork(known, id('10.0.1.1'), POLICIES.org)).toBe(false);
    const locked = { lockedUntil: new Date(Date.now() + 10 * MIN), knownNetworks: known };
    expect((await beginAttempt('org', 't:d@x.test', '10.0.7.200', locked)).refused).toBeNull();
    expect((await beginAttempt('org', 't:d@x.test', '10.0.1.1', locked)).refused).toBe('account');
    expect(isKnownNetwork(known, id('10.0.7.9'), POLICIES.org, Date.now() + 31 * 24 * 60 * MIN)).toBe(false);
  });

  it('network ids are keyed hashes, different per account', () => {
    expect(networkId('org', 't:a@x.test', '192.0.2.1')).toBe(networkId('org', 'T:A@x.test', '192.0.2.250'));
    expect(networkId('org', 't:a@x.test', '192.0.2.1')).not.toBe(networkId('org', 't:b@x.test', '192.0.2.1'));
    expect(networkId('org', 't:a@x.test', '192.0.2.1')).not.toContain('192');
  });

  it('the whole account: 50 failures, 15 min doubling, capped at 1 h; the Dev console 20, 30 min to 2 h', () => {
    expect([1, 2, 3, 4].map((l) => lockDuration(l, accountRule(POLICIES.org)) / MIN)).toEqual([15, 30, 60, 60]);
    expect([1, 2, 3, 4].map((l) => lockDuration(l, accountRule(POLICIES.platform)) / MIN)).toEqual([30, 60, 120, 120]);
    const now = new Date();
    expect(afterFailure({ failedCount: 48, lastFailedAt: now, lockLevel: 0, lastLockedAt: null }, accountRule(POLICIES.org), now).lockedUntil).toBeNull();
    expect(afterFailure({ failedCount: 49, lastFailedAt: now, lockLevel: 0, lastLockedAt: null }, accountRule(POLICIES.org), now).lockedUntil).not.toBeNull();
  });
});

describe('address keys', () => {
  it('IPv4 as is (/24 for networks); IPv6 by /64; IPv4-mapped IPv6 as IPv4', () => {
    expect(addressKey('192.0.2.7')).toBe('192.0.2.7');
    expect(networkKey('192.0.2.7')).toBe('192.0.2.0/24');
    expect(addressKey('::ffff:192.0.2.7')).toBe('192.0.2.7');
    expect(addressKey('2001:db8:0:1::5')).toBe('2001:db8:0:1::/64');
    expect(addressKey('2001:0db8:0000:0001:ffff:1:2:3')).toBe('2001:db8:0:1::/64');
    expect(networkKey('2001:db8:0:1:abcd::1')).toBe('2001:db8:0:1::/64');
    expect(addressKey('2001:db8:0:2::5')).not.toBe(addressKey('2001:db8:0:1::5'));
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey(undefined)).toBe('unknown');
  });
});

describe('kiosk PIN rules', () => {
  it('refuses common, repeated, sequential and own-number PINs', () => {
    for (const p of ['1234', '0000', '7777', '2345', '6543', '98765', '901234', '1313', '121212', '125125', '2580', '123123']) expect(weakPin(p), p).toBe(true);
    expect(weakPin('4821', 'E004821')).toBe(true);
    expect(weakPin('4821', '48219')).toBe(true);
    for (const p of ['4826', '5937', '193847', '7302']) expect(weakPin(p, 'E100'), p).toBe(false);
  });
});

describe('lockout email', () => {
  it('EN and FR, with the time and the reset link, “if this wasn’t you”', () => {
    const p = { name: 'Sam', organization: 'City of Kelowna', at: 'November 12, 2026, 3:04 p.m. PST', until: 'November 12, 2026, 3:19 p.m. PST', url: 'https://kelowna.example/forgot' };
    const en = renderEmail('account_locked', 'en-CA', p);
    expect(en.subject).toMatch(/paused/);
    expect(en.text).toContain(p.until);
    expect(en.text).toContain(p.url);
    expect(en.text).toMatch(/If this wasn't you/);
    const fr = renderEmail('account_locked', 'fr-CA', p);
    expect(fr.subject).toMatch(/suspendue/);
    expect(fr.text).toMatch(/Si ce n’était pas vous/);
    expect(fr.text).toContain(p.url);
  });
});
