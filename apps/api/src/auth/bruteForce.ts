/**
 * Defences against password guessing and credential stuffing (docs/ARCHITECTURE.md, "Brute-force
 * and credential stuffing"), for organization sign-in ("org") and, stricter, the FH Dev console
 * ("platform"):
 *
 * 1. Per account and source network (IPv4 /24, IPv6 /64; lib/address.ts): after `failures` wrong
 *    passwords from one network within `windowMs`, that network can't sign in to that account for
 *    `baseLockMs`, doubling with each further lock within `windowMs`, up to `maxLockMs`. Someone
 *    guessing from elsewhere never locks the person out of their own network.
 * 2. Per account, across networks (a distributed attack): above `accountFailures` wrong passwords
 *    within `windowMs` the whole account locks, for shorter periods (`accountBaseLockMs`, doubling,
 *    capped at `accountMaxLockMs`), and the person is emailed once per lock. Even then, a network
 *    the account signed in from recently (the last `knownNetworks`, within `knownForMs`; kept as
 *    keyed hashes on the account) still gets in: a whole-account lock is never a way to keep
 *    someone out of their usual office or home.
 * 3. Per address, across accounts (one address trying a list of emails): failing on
 *    `ipDistinctAccounts` different accounts within `ipWindowMs` blocks that address from signing
 *    in for `ipBlockMs`. Unknown emails count too: stuffing lists are mostly addresses we don't have.
 *
 * Attempts are counted before the password is checked (an atomic reservation, auth/rateLimit.ts
 * reserve()), and a right password gives its slot back, so a burst of parallel guesses can't all
 * slip under a limit while the hash is computed. The outcome is recorded under a row lock on the
 * account (SELECT … FOR UPDATE), so concurrent failures all count and a lock (and its email) happens
 * once.
 *
 * None of this changes what the person trying sees: a locked account or network answers exactly
 * like a wrong password (401 INVALID_CREDENTIALS), so an attacker can't learn which emails have
 * accounts or which are locked. Only hashes of the account and network appear in the rate-limit
 * store, never the email or the address.
 */
import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { addressKey, networkKey } from '../lib/address.js';
import { clearPrefix, count, distinctCount, latest, record, reserve, type Release } from './rateLimit.js';

export type Surface = 'org' | 'platform';

/** How failures turn into locks: `failures` within `windowMs` lock for base, doubling, capped. */
export interface LockRule {
  failures: number;
  baseLockMs: number;
  maxLockMs: number;
  windowMs: number;
}

export interface BruteForcePolicy extends LockRule {
  accountFailures: number;
  accountBaseLockMs: number;
  accountMaxLockMs: number;
  knownNetworks: number;
  knownForMs: number;
  ipDistinctAccounts: number;
  ipWindowMs: number;
  ipBlockMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const POLICIES: Record<Surface, BruteForcePolicy> = {
  org: { failures: 5, baseLockMs: 15 * MIN, maxLockMs: 24 * HOUR, windowMs: 24 * HOUR, accountFailures: 50, accountBaseLockMs: 15 * MIN, accountMaxLockMs: HOUR, knownNetworks: 5, knownForMs: 30 * DAY, ipDistinctAccounts: 10, ipWindowMs: 15 * MIN, ipBlockMs: HOUR },
  // A handful of FH staff with a passkey as well: three wrong passwords is already unusual.
  platform: { failures: 3, baseLockMs: 30 * MIN, maxLockMs: 24 * HOUR, windowMs: 24 * HOUR, accountFailures: 20, accountBaseLockMs: 30 * MIN, accountMaxLockMs: 2 * HOUR, knownNetworks: 3, knownForMs: 14 * DAY, ipDistinctAccounts: 3, ipWindowMs: 15 * MIN, ipBlockMs: HOUR },
};

/** How long the nth lock (1-based) within the window lasts: base, doubling, capped. */
export function lockDuration(level: number, p: LockRule): number {
  return Math.min(p.maxLockMs, p.baseLockMs * 2 ** Math.max(0, level - 1));
}

export interface AccountState {
  failedCount: number;
  lastFailedAt: Date | null;
  lockLevel: number;
  lastLockedAt: Date | null;
}

/**
 * What a wrong password does to an account: the new counters, and whether it now locks (until when).
 * Pure, so the escalation is unit-tested without a database.
 */
export function afterFailure(s: AccountState, p: LockRule, now = new Date()): { failedCount: number; lastFailedAt: Date; lockLevel: number; lastLockedAt: Date | null; lockedUntil: Date | null } {
  const recent = s.lastFailedAt && now.getTime() - s.lastFailedAt.getTime() < p.windowMs;
  const failed = (recent ? s.failedCount : 0) + 1;
  if (failed < p.failures) return { failedCount: failed, lastFailedAt: now, lockLevel: s.lockLevel, lastLockedAt: s.lastLockedAt, lockedUntil: null };
  const escalate = s.lastLockedAt && now.getTime() - s.lastLockedAt.getTime() < p.windowMs;
  const level = escalate ? s.lockLevel + 1 : 1;
  return { failedCount: 0, lastFailedAt: now, lockLevel: level, lastLockedAt: now, lockedUntil: new Date(now.getTime() + lockDuration(level, p)) };
}

/** The whole-account rule: many more failures, shorter locks. */
export const accountRule = (p: BruteForcePolicy): LockRule => ({ failures: p.accountFailures, baseLockMs: p.accountBaseLockMs, maxLockMs: p.accountMaxLockMs, windowMs: p.windowMs });

/** The counters after a successful sign-in or a password reset. */
export const cleared = { failedCount: 0, lockLevel: 0, lockedUntil: null } as const;

const hash = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 22);
const ipFailKey = (surface: Surface, ip: string) => `signin-fail:${surface}:${addressKey(ip)}|`;
const blockKey = (surface: Surface, ip: string) => `signin-block:${surface}:${addressKey(ip)}`;
const accountKey = (surface: Surface, account: string) => `acct:${surface}:${hash(account.toLowerCase())}:`;

/**
 * The network's id for this account: a keyed hash (the server's secret), so the stored ids can't be
 * turned back into networks by trying all 2^24 IPv4 /24s, and differ between accounts.
 */
export function networkId(surface: Surface, account: string, ip: string | undefined): string {
  return createHmac('sha256', config().JWT_SECRET).update(`${surface}|${account.toLowerCase()}|${networkKey(ip)}`).digest('base64url').slice(0, 22);
}

/** Known networks are stored as "<network id>~<last sign-in, ms>", most recent first. */
export function isKnownNetwork(list: readonly string[], id: string, p: BruteForcePolicy, now = Date.now()): boolean {
  return list.some((e) => {
    const [n, at] = e.split('~');
    return n === id && now - Number(at) < p.knownForMs;
  });
}

/** The list after a successful sign-in from this network: it moves to the front; old ones drop off. */
export function rememberNetwork(list: readonly string[], id: string, p: BruteForcePolicy, now = Date.now()): string[] {
  const kept = list.filter((e) => {
    const [n, at] = e.split('~');
    return n !== id && now - Number(at) < p.knownForMs;
  });
  return [`${id}~${now}`, ...kept].slice(0, p.knownNetworks);
}

/** One sign-in attempt on a known account, between the check before the password and the outcome after it. */
export interface Attempt {
  surface: Surface;
  account: string;
  network: string;
  /** The account signed in from this network recently. */
  known: boolean;
  /** Why it is refused whatever the password: this network is locked out, or the whole account is. */
  refused: null | 'network' | 'account';
  slot: Release | null;
}

/** This network's failure counter on the account (exported for tests). */
export const failKey = (a: Pick<Attempt, 'surface' | 'account' | 'network'>) => `${accountKey(a.surface, a.account)}fail:${a.network}`;
const netLockKey = (a: Pick<Attempt, 'surface' | 'account' | 'network'>) => `${accountKey(a.surface, a.account)}lock:${a.network}`;

/** Until when this network is locked out of the account (the nth lock within the window lasts base × 2^(n−1)), or null. */
export async function networkLockedUntil(a: Pick<Attempt, 'surface' | 'account' | 'network'>, now = Date.now()): Promise<Date | null> {
  const p = POLICIES[a.surface];
  const locks = await count(netLockKey(a), p.windowMs);
  if (!locks) return null;
  const last = await latest(netLockKey(a), p.windowMs);
  const until = (last ?? 0) + lockDuration(locks, p);
  return until > now ? new Date(until) : null;
}

/**
 * Before the password check: is this attempt refused whatever the password, and if not, reserve
 * its place among this network's allowed failures (so parallel guesses can't exceed them).
 */
export async function beginAttempt(surface: Surface, account: string, ip: string | undefined, state: { lockedUntil: Date | null; knownNetworks: readonly string[] }, now = new Date()): Promise<Attempt> {
  const p = POLICIES[surface];
  const a: Attempt = { surface, account, network: networkId(surface, account, ip), known: false, refused: null, slot: null };
  a.known = isKnownNetwork(state.knownNetworks, a.network, p, now.getTime());
  if (await networkLockedUntil(a, now.getTime())) a.refused = 'network';
  else if (state.lockedUntil && state.lockedUntil > now && !a.known) a.refused = 'account';
  else {
    a.slot = await reserve(failKey(a), p.failures, p.windowMs);
    if (!a.slot) a.refused = 'network';
  }
  return a;
}

/**
 * A wrong password (call under the account's row lock): its reserved slot stays as a failure; the
 * failure that reaches the limit locks this network out (once). Returns that lock, if any.
 */
export async function failedAttempt(a: Attempt, now = new Date()): Promise<{ until: Date; level: number } | null> {
  const p = POLICIES[a.surface];
  if (!a.slot) return null;
  if ((await count(failKey(a), p.windowMs)) < p.failures || (await networkLockedUntil(a, now.getTime()))) return null;
  await record(netLockKey(a));
  await clearPrefix(failKey(a));
  const level = await count(netLockKey(a), p.windowMs);
  return { until: new Date(now.getTime() + lockDuration(level, p)), level };
}

/** The right password: the slot is given back and this network's failures and locks are forgotten. */
export async function succeededAttempt(a: Attempt): Promise<void> {
  await a.slot?.();
  await clearPrefix(failKey(a));
  await clearPrefix(netLockKey(a));
}

/** Not decided by the password (e.g. refused later for another reason): give the slot back. */
export async function abandonAttempt(a: Attempt | null): Promise<void> {
  await a?.slot?.();
}

/**
 * A sign-in by another proof (a passkey): this network's failures and locks on the account are
 * forgotten and it becomes a known network. Returns the new known-network list to store.
 */
export async function signedInFrom(surface: Surface, account: string, ip: string | undefined, known: readonly string[], now = Date.now()): Promise<string[]> {
  const a = { surface, account, network: networkId(surface, account, ip) };
  await clearPrefix(failKey(a));
  await clearPrefix(netLockKey(a));
  return rememberNetwork(known, a.network, POLICIES[surface], now);
}

/** A password reset (or an administrator's unlock): every network's failures and locks on the account are forgotten. */
export async function clearAccount(surface: Surface, account: string): Promise<void> {
  await clearPrefix(accountKey(surface, account));
}

/** This address is blocked from signing in (it failed on too many different accounts). */
export async function ipBlocked(surface: Surface, ip: string | undefined): Promise<boolean> {
  if (!ip) return false;
  return (await count(blockKey(surface, ip), POLICIES[surface].ipBlockMs)) > 0;
}

/**
 * Notes a failed sign-in from this address on this account (`account` is e.g. tenant + email; it is
 * hashed). Returns true when this failure blocks the address (once, at the moment it happens).
 */
export async function noteFailure(surface: Surface, ip: string | undefined, account: string): Promise<boolean> {
  if (!ip) return false;
  const p = POLICIES[surface];
  await record(`${ipFailKey(surface, ip)}${hash(account.toLowerCase())}`);
  if ((await distinctCount(ipFailKey(surface, ip), p.ipWindowMs)) < p.ipDistinctAccounts) return false;
  if (await ipBlocked(surface, ip)) return false;
  await record(blockKey(surface, ip));
  return true;
}
