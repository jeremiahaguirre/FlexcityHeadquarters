/** Signing in to the FH Dev console (FH staff only, separate from organization sign-in). */
import { Router } from 'express';
import { z } from 'zod';
import { PLATFORM_COOKIE, endPlatformSession, platformCookieOpts, platformMfaRequired, platformOf, requirePlatformSession, startPlatformSession } from '../../auth/platform.js';
import { allow } from '../../auth/rateLimit.js';
import { POLICIES, abandonAttempt, accountRule, afterFailure, beginAttempt, failedAttempt, ipBlocked, noteFailure, rememberNetwork, succeededAttempt } from '../../auth/bruteForce.js';
import { addressKey } from '../../lib/address.js';
import { authFailures, authIpBlocks, authLockouts } from '../../lib/metrics.js';
import { verifyPassword } from '../../auth/tokens.js';
import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { h } from '../context.js';

export const platformAuthRouter = Router();

const invalid = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
const tooMany = () => new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait a few minutes and try again.');

/**
 * Dev console sign-in, stricter than an organization's (auth/bruteForce.ts POLICIES.platform):
 * 3 wrong passwords from one network lock that network out for 30 minutes, doubling to 24 hours;
 * 20 across networks lock the whole account (30 minutes doubling to 2 hours) except for the
 * networks it recently signed in from; an address failing on 3 different emails is blocked for an
 * hour. Attempts are reserved before the password check and decided under a row lock (no
 * parallel-guess bypass). Locked, unknown and wrong all answer 401 INVALID_CREDENTIALS. Locks and
 * blocks go to the console's own audit (an admin's) and to metrics, which alert on them.
 */
platformAuthRouter.post(
  '/auth/login',
  h(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const policy = POLICIES.platform;
    const lower = email.toLowerCase();
    if (await ipBlocked('platform', req.ip)) {
      authFailures.inc({ surface: 'platform', reason: 'blocked_ip' });
      throw tooMany();
    }
    if (!await allow(`platform-login:${addressKey(req.ip)}`, 10, 10 * 60_000)) {
      authFailures.inc({ surface: 'platform', reason: 'rate_limited' });
      throw tooMany();
    }
    const pre = await db().platformAdmin.findUnique({ where: { email: lower }, select: { id: true, passwordHash: true, lockedUntil: true, knownNetworks: true } });
    const attempt = pre ? await beginAttempt('platform', lower, req.ip, pre) : null;
    const ok = pre ? await verifyPassword(password, pre.passwordHash) : await verifyPassword(password, 'scrypt$AAAA$AAAA').then(() => false);
    const outcome = await db().$transaction(async (tx) => {
      if (!pre || !attempt) return { signedIn: null, locked: false };
      await tx.$queryRaw`SELECT id FROM "PlatformAdmin" WHERE id = ${pre.id}::uuid FOR UPDATE`;
      const admin = await tx.platformAdmin.findUniqueOrThrow({ where: { id: pre.id } });
      const now = new Date();
      const locked = !!attempt.refused || (!!admin.lockedUntil && admin.lockedUntil > now && !attempt.known);
      if (!ok && !attempt.refused) {
        const networkLock = await failedAttempt(attempt, now);
        if (networkLock) {
          authLockouts.inc({ surface: 'platform', scope: 'network' });
          await tx.platformAudit.create({ data: { adminId: admin.id, action: 'auth.network_locked', detail: { until: networkLock.until.toISOString(), level: networkLock.level, ip: req.ip ?? null } } });
        }
        if (!(admin.lockedUntil && admin.lockedUntil > now)) {
          const next = afterFailure({ failedCount: admin.failedLogins, lastFailedAt: admin.lastFailedLoginAt, lockLevel: admin.lockoutLevel, lastLockedAt: admin.lastLockedAt }, accountRule(policy), now);
          await tx.platformAdmin.update({ where: { id: admin.id }, data: { failedLogins: next.failedCount, lastFailedLoginAt: next.lastFailedAt, lockoutLevel: next.lockLevel, lastLockedAt: next.lastLockedAt, ...(next.lockedUntil ? { lockedUntil: next.lockedUntil } : {}) } });
          if (next.lockedUntil) {
            authLockouts.inc({ surface: 'platform', scope: 'account' });
            await tx.platformAudit.create({ data: { adminId: admin.id, action: 'auth.account_locked', detail: { until: next.lockedUntil.toISOString(), level: next.lockLevel, ip: req.ip ?? null } } });
          }
        }
      }
      if (!ok || locked || admin.disabledAt) return { signedIn: null, locked };
      await succeededAttempt(attempt);
      const stillLocked = !!admin.lockedUntil && admin.lockedUntil > now;
      await tx.platformAdmin.update({ where: { id: admin.id }, data: { knownNetworks: rememberNetwork(admin.knownNetworks, attempt.network, policy, now.getTime()), lastLoginAt: now, ...(stillLocked ? {} : { failedLogins: 0, lockedUntil: null, lockoutLevel: 0 }) } });
      return { signedIn: admin, locked: false };
    });
    if (!outcome.signedIn) {
      if (ok) await abandonAttempt(attempt);
      authFailures.inc({ surface: 'platform', reason: outcome.locked ? 'locked' : 'invalid' });
      if (!ok && (await noteFailure('platform', req.ip, email))) {
        authIpBlocks.inc({ surface: 'platform' });
        if (pre) await db().platformAudit.create({ data: { adminId: pre.id, action: 'auth.ip_blocked', detail: { ip: req.ip ?? null, forMinutes: policy.ipBlockMs / 60_000 } } });
      }
      throw invalid();
    }
    const admin = outcome.signedIn;
    res.cookie(PLATFORM_COOKIE, await startPlatformSession(admin.id), platformCookieOpts());
    const hasPasskey = (await db().platformPasskey.count({ where: { adminId: admin.id } })) > 0;
    // A password alone isn't enough: the console asks for a passkey next (or to set one up).
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name }, mfaRequired: platformMfaRequired(), hasPasskey });
  }),
);

platformAuthRouter.post(
  '/auth/logout',
  h(async (req, res) => {
    await endPlatformSession(req.cookies?.[PLATFORM_COOKIE] as string | undefined);
    res.clearCookie(PLATFORM_COOKIE, { path: '/api/platform' });
    res.status(204).end();
  }),
);

platformAuthRouter.get(
  '/me',
  requirePlatformSession,
  h(async (req, res) => {
    const p = platformOf(req);
    const hasPasskey = (await db().platformPasskey.count({ where: { adminId: p.adminId } })) > 0;
    res.json({ id: p.adminId, email: p.email, name: p.name, mfa: p.mfa, mfaRequired: platformMfaRequired() && !p.mfa, hasPasskey, permissions: p.permissions });
  }),
);
