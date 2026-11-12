/**
 * Defences against password guessing and credential stuffing (docs/ARCHITECTURE.md, "Brute-force
 * and credential stuffing"). Two independent controls, for organization sign-in ("org") and,
 * stricter, the FH Dev console ("platform"):
 *
 * 1. Per account, across every address (a distributed attack): after `failures` wrong passwords
 *    the account locks for `baseLockMs`; each further lock within `windowMs` of the previous one
 *    doubles it, up to `maxLockMs`. A successful sign-in (or a password reset) starts over.
 *    Failures older than `windowMs` are forgotten.
 * 2. Per address, across accounts (one address trying a list of emails): failing on
 *    `ipDistinctAccounts` different accounts within `ipWindowMs` blocks that address from signing
 *    in for `ipBlockMs`. Unknown emails count too: stuffing lists are mostly addresses we don't have.
 *
 * Neither control changes what the person trying sees: a locked account answers exactly like a
 * wrong password (401 INVALID_CREDENTIALS), so an attacker can't learn which emails have accounts
 * or which are locked. The person is told by email instead (account_locked), once per lock.
 * Only a hash of the account appears in the rate-limit store, never the email.
 */
import { createHash } from 'node:crypto';
import { count, distinctCount, record } from './rateLimit.js';

export type Surface = 'org' | 'platform';

export interface BruteForcePolicy {
  failures: number;
  baseLockMs: number;
  maxLockMs: number;
  windowMs: number;
  ipDistinctAccounts: number;
  ipWindowMs: number;
  ipBlockMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
export const POLICIES: Record<Surface, BruteForcePolicy> = {
  org: { failures: 5, baseLockMs: 15 * MIN, maxLockMs: 24 * HOUR, windowMs: 24 * HOUR, ipDistinctAccounts: 10, ipWindowMs: 15 * MIN, ipBlockMs: HOUR },
  // A handful of FH staff with a passkey as well: three wrong passwords is already unusual.
  platform: { failures: 3, baseLockMs: 30 * MIN, maxLockMs: 24 * HOUR, windowMs: 24 * HOUR, ipDistinctAccounts: 3, ipWindowMs: 15 * MIN, ipBlockMs: HOUR },
};

/** How long the nth lock (1-based) within the window lasts: base, doubling, capped. */
export function lockDuration(level: number, p: BruteForcePolicy): number {
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
export function afterFailure(s: AccountState, p: BruteForcePolicy, now = new Date()): { failedCount: number; lastFailedAt: Date; lockLevel: number; lastLockedAt: Date | null; lockedUntil: Date | null } {
  const recent = s.lastFailedAt && now.getTime() - s.lastFailedAt.getTime() < p.windowMs;
  const failed = (recent ? s.failedCount : 0) + 1;
  if (failed < p.failures) return { failedCount: failed, lastFailedAt: now, lockLevel: s.lockLevel, lastLockedAt: s.lastLockedAt, lockedUntil: null };
  const escalate = s.lastLockedAt && now.getTime() - s.lastLockedAt.getTime() < p.windowMs;
  const level = escalate ? s.lockLevel + 1 : 1;
  return { failedCount: 0, lastFailedAt: now, lockLevel: level, lastLockedAt: now, lockedUntil: new Date(now.getTime() + lockDuration(level, p)) };
}

/** The counters after a successful sign-in or a password reset. */
export const cleared = { failedCount: 0, lockLevel: 0, lockedUntil: null } as const;

const hash = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 22);
const failKey = (surface: Surface, ip: string) => `signin-fail:${surface}:${ip}|`;
const blockKey = (surface: Surface, ip: string) => `signin-block:${surface}:${ip}`;

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
  await record(`${failKey(surface, ip)}${hash(account.toLowerCase())}`);
  if ((await distinctCount(failKey(surface, ip), p.ipWindowMs)) < p.ipDistinctAccounts) return false;
  if (await ipBlocked(surface, ip)) return false;
  await record(blockKey(surface, ip));
  return true;
}
