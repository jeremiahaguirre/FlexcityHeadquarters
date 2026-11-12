/** Signing in to an organization: password sign-in, refreshing and ending a session, password reset. */
import { Router } from 'express';
import { z } from 'zod';
import { appUrl, consumeAuthToken, issueAuthToken } from '../auth/authTokens.js';
import { allow, reserve } from '../auth/rateLimit.js';
import { refuseBreached } from '../auth/breachedPasswords.js';
import { epochSeconds, hashPassword, signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshFamily, verifyPassword } from '../auth/tokens.js';
import { config } from '../config.js';
import { isCommonPassword, isPersonalPassword } from '../auth/commonPasswords.js';
import { audit, type Tx, withTenant } from '../lib/db.js';
import { authFailures, authIpBlocks, authLockouts } from '../lib/metrics.js';
import { POLICIES, abandonAttempt, accountRule, afterFailure, beginAttempt, clearAccount, failedAttempt, ipBlocked, isKnownNetwork, networkId, noteFailure, rememberNetwork, succeededAttempt } from '../auth/bruteForce.js';
import { addressKey, networkKey } from '../lib/address.js';
import { HttpError } from '../lib/errors.js';
import { permissionsFor } from '../auth/permissions.js';
import { connectionFor, publicSso, ready } from '../services/auth/sso.js';
import { notify } from '../services/notifications/notifier.js';
import { h, lookupTenant, subdomainOf } from './context.js';

export const COOKIE = 'fc_refresh';

/**
 * Password rules (NIST SP 800-63B in spirit: length and a block list over composition tricks, no
 * forced expiry): at least 12 characters, letters with numbers or symbols, at least 5 different
 * characters, not a commonly used password. checkPersonalPassword() adds the person's own details
 * once they are known (reset and change).
 */
export const PASSWORD_MIN = 12;
export const passwordRule = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /[^A-Za-z]/.test(p), 'Mix letters with numbers or symbols.')
  .refine((p) => new Set(p).size >= 5, 'Use more different characters.')
  .refine((p) => !isCommonPassword(p), 'That password is too common. Choose something less predictable.');

/** Refuses a password made from the person's own details or their organization's name. */
export function checkPersonalPassword(password: string, about: Parameters<typeof isPersonalPassword>[1]): void {
  if (isPersonalPassword(password, about)) throw new HttpError(400, 'PASSWORD_PERSONAL', 'Don’t use your name, email or your organization’s name in your password.');
}

export const cookieOpts = () => ({
  httpOnly: true,
  secure: config().NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: config().REFRESH_TOKEN_TTL_DAYS * 86_400_000,
});

export const authRouter = Router();

authRouter.get(
  '/public/tenant',
  h(async (req, res) => {
    const sub = subdomainOf(req);
    const t = sub ? await lookupTenant(sub) : null;
    if (!t) throw new HttpError(404, 'NOT_FOUND', 'Organization not found');
    const { disabledAt, exportUntil, ...branding } = t;
    // A closed organization only says that its administrators can still download its data.
    res.json({ ...branding, sso: await publicSso(t.id), ...(disabledAt ? { closed: { exportUntil: exportUntil && new Date(exportUntil) > new Date() ? exportUntil : null } } : {}) });
  }),
);

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

/** The one answer for a wrong password, an unknown email and a locked account alike. */
export const INVALID_LOGIN = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect. After several tries, signing in pauses for a while: reset your password to get in now.');
const tooMany = () => new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait a few minutes and try again.');

/** A date and time as the person reads it, in their organization's first facility's time zone. */
function when(d: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale.startsWith('fr') ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(d);
}

/** Queues the "sign-in paused" email (once per lock: only the failure that locks calls this). */
async function queueLockedEmail(tx: Tx, tenantId: string, user: { id: string; email: string; firstName: string; locale: string; status: string }, at: Date, until: Date, sub: string | undefined) {
  if (user.status !== 'ACTIVE' || !sub) return;
  const [org, facility] = await Promise.all([tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }), tx.facility.findFirst({ orderBy: { createdAt: 'asc' }, select: { timezone: true } })]);
  const zone = facility?.timezone ?? 'America/Toronto';
  await tx.emailOutbox.create({
    data: { tenantId, toEmail: user.email, template: 'account_locked', locale: user.locale, params: { name: user.firstName, organization: org.name, at: when(at, user.locale, zone), until: when(until, user.locale, zone), url: appUrl(sub, '/forgot') } },
  });
}

/** Attempts per address on one organization, right or wrong: a flood backstop (failures have their own, lower limit). */
export const LOGIN_ATTEMPTS_PER_ADDRESS = 200;
/** Wrong sign-ins per address on one organization: only failures count, so an office behind one address can all sign in. */
export const LOGIN_FAILURES_PER_ADDRESS = 20;
const LOGIN_WINDOW_MS = 10 * 60_000;
const DUMMY_HASH = 'scrypt$AAAA$AAAA';

/**
 * Password sign-in. Brute-force defences (auth/bruteForce.ts): an address that failed on many
 * different accounts is blocked for an hour; a network that keeps failing on one account is locked
 * out of it progressively; very many failures across networks lock the whole account, except for
 * the networks it recently signed in from. Each attempt takes its place among the allowed failures
 * before the password is checked, and its outcome is recorded under a row lock on the account, so
 * parallel guesses can't get past the limits. Unknown emails, wrong passwords and locked accounts
 * get the same answer, after the same password check (similar timing); the person whose account
 * locked is emailed instead (once per whole-account lock).
 */
authRouter.post(
  '/auth/login',
  h(async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const tenantId = req.tenantId!;
    const policy = POLICIES.org;
    const addr = addressKey(req.ip);
    const account = `${tenantId}:${email.toLowerCase()}`;
    if (await ipBlocked('org', req.ip)) {
      authFailures.inc({ surface: 'org', reason: 'blocked_ip' });
      throw tooMany();
    }
    if (!(await allow(`login-all:${addr}:${tenantId}`, LOGIN_ATTEMPTS_PER_ADDRESS, LOGIN_WINDOW_MS))) {
      authFailures.inc({ surface: 'org', reason: 'rate_limited' });
      throw tooMany();
    }
    const addressSlot = await reserve(`login:${addr}:${tenantId}`, LOGIN_FAILURES_PER_ADDRESS, LOGIN_WINDOW_MS);
    if (!addressSlot) {
      authFailures.inc({ surface: 'org', reason: 'rate_limited' });
      throw tooMany();
    }
    const sub = subdomainOf(req) ?? undefined;
    // Before the password check: the account's lock state, and this attempt's reserved place.
    const pre = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { tenantId_email: { tenantId, email: email.toLowerCase() } }, select: { id: true, passwordHash: true, lockedUntil: true, knownNetworks: true } }));
    const attempt = pre ? await beginAttempt('org', account, req.ip, pre) : null;
    // Always check a password, against a dummy hash for an unknown email: similar timing either way.
    const ok = pre?.passwordHash ? await verifyPassword(password, pre.passwordHash) : await verifyPassword(password, DUMMY_HASH).then(() => false);
    // The transaction returns its outcome instead of throwing, so the failure counters are
    // committed even when the sign-in is refused.
    const outcome = await withTenant(tenantId, async (tx) => {
      // One attempt at a time per account from here: concurrent failures all count, a lock happens once.
      if (pre) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${pre.id}::uuid FOR UPDATE`;
      const user = pre ? await tx.user.findUnique({ where: { id: pre.id } }) : null;
      const now = new Date();
      const accountLocked = !!user?.lockedUntil && user.lockedUntil > now && !attempt?.known;
      const locked = !!attempt?.refused || accountLocked;
      if (user && attempt && !ok && !attempt.refused) {
        const networkLock = await failedAttempt(attempt, now);
        if (networkLock) {
          authLockouts.inc({ surface: 'org', scope: 'network' });
          await audit(tx, { tenantId, actorId: null, action: 'auth.network_locked', entity: 'User', entityId: user.id, after: { until: networkLock.until, level: networkLock.level, ip: req.ip ?? null } });
        }
        // The whole account counts every network's failures (not while it is already locked).
        if (!(user.lockedUntil && user.lockedUntil > now)) {
          const next = afterFailure({ failedCount: user.failedLoginCount, lastFailedAt: user.lastFailedLoginAt, lockLevel: user.lockoutLevel, lastLockedAt: user.lastLockedAt }, accountRule(policy), now);
          await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: next.failedCount, lastFailedLoginAt: next.lastFailedAt, lockoutLevel: next.lockLevel, lastLockedAt: next.lastLockedAt, ...(next.lockedUntil ? { lockedUntil: next.lockedUntil } : {}) } });
          if (next.lockedUntil) {
            authLockouts.inc({ surface: 'org', scope: 'account' });
            await audit(tx, { tenantId, actorId: null, action: 'auth.account_locked', entity: 'User', entityId: user.id, after: { until: next.lockedUntil, level: next.lockLevel, ip: req.ip ?? null } });
            await queueLockedEmail(tx, tenantId, user, now, next.lockedUntil, sub);
          }
        }
      }
      // Closed (offboarded) organizations admit only administrators, single-sign-on-only ones only
      // the people who can turn it off; anyone else, including an administrator with a wrong
      // password, gets the organization's answer, so it never tells accounts apart.
      const admits = !!user && ok && !locked && permissionsFor(user.roles).has('tenant.configure');
      const org = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { disabledAt: true } });
      if (org.disabledAt && !admits) return { kind: 'closed' as const };
      const sso = await connectionFor(tx);
      if (ready(sso) && sso.enforced && !admits) return { kind: 'sso' as const };
      if (locked) return { kind: 'invalid' as const, reason: 'locked' };
      if (!user || !ok || user.status !== 'ACTIVE' || user.processingRestrictedAt) return { kind: 'invalid' as const, reason: 'invalid' };
      if (attempt) await succeededAttempt(attempt);
      // A sign-in from a known network during a whole-account lock leaves the lock for everyone else.
      const stillLocked = !!user.lockedUntil && user.lockedUntil > now;
      await tx.user.update({ where: { id: user.id }, data: { knownNetworks: rememberNetwork(user.knownNetworks, attempt!.network, policy, now.getTime()), ...(stillLocked ? {} : { failedLoginCount: 0, lockedUntil: null, lockoutLevel: 0 }) } });
      const refresh = await issueRefreshToken(tx, tenantId, user.id);
      return { kind: 'ok' as const, user, refresh };
    });
    // A right password isn't a failure: its places are given back, whatever the outcome.
    if (ok) {
      await addressSlot();
      await abandonAttempt(attempt);
    } else {
      // Every wrong password counts toward the address's many-accounts block, whatever the organization's answer.
      if (await noteFailure('org', req.ip, account)) {
        authIpBlocks.inc({ surface: 'org' });
        await withTenant(tenantId, (tx) => audit(tx, { tenantId, actorId: null, action: 'auth.ip_blocked', entity: 'Address', after: { ip: req.ip ?? null, forMinutes: policy.ipBlockMs / 60_000, distinctAccounts: policy.ipDistinctAccounts } }));
      }
    }
    if (outcome.kind === 'closed') throw new HttpError(403, 'ORG_DISABLED', 'This organization’s account is closed. Contact FlexcityHeadquarters.');
    if (outcome.kind === 'sso') throw new HttpError(403, 'SSO_REQUIRED', 'Your organization signs in with single sign-on. Use the button above.');
    if (outcome.kind === 'invalid') {
      authFailures.inc({ surface: 'org', reason: outcome.reason });
      throw INVALID_LOGIN();
    }
    const result = outcome;
    const accessToken = await signAccessToken({ sub: result.user.id, tid: tenantId, roles: result.user.roles, aat: epochSeconds() });
    res.cookie(COOKIE, result.refresh, cookieOpts());
    res.json({
      accessToken,
      user: { id: result.user.id, firstName: result.user.firstName, lastName: result.user.lastName, roles: result.user.roles, locale: result.user.locale },
    });
  }),
);

authRouter.post(
  '/auth/refresh',
  h(async (req, res) => {
    const raw = req.cookies?.[COOKIE] as string | undefined;
    if (!raw) throw new HttpError(401, 'UNAUTHENTICATED', 'No session');
    const tenantId = req.tenantId!;
    const rotated = await withTenant(tenantId, async (tx) => {
      const r = await rotateRefreshToken(tx, raw);
      if (!r) return null;
      const user = await tx.user.findUniqueOrThrow({ where: { id: r.userId } });
      if (user.status !== 'ACTIVE' || user.processingRestrictedAt) return null;
      return { ...r, roles: user.roles };
    });
    if (!rotated) {
      res.clearCookie(COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'UNAUTHENTICATED', 'Session expired');
    }
    res.cookie(COOKIE, rotated.token, cookieOpts());
    res.json({ accessToken: await signAccessToken({ sub: rotated.userId, tid: tenantId, roles: rotated.roles, aat: epochSeconds(rotated.authenticatedAt), mfa: rotated.mfa }) });
  }),
);

authRouter.post(
  '/auth/logout',
  h(async (req, res) => {
    const raw = req.cookies?.[COOKIE] as string | undefined;
    if (raw) await withTenant(req.tenantId!, (tx) => revokeRefreshFamily(tx, raw));
    res.clearCookie(COOKIE, { path: '/api/auth' });
    res.status(204).end();
  }),
);

const FORGOT_FLOOR_MS = 150;
/** Reset links per email per hour across every network (each network: 3). */
export const FORGOT_PER_EMAIL = 10;

/** Always answers 202 so it can't be used to discover which emails have accounts. */
authRouter.post(
  '/auth/forgot',
  h(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const tenantId = req.tenantId!;
    const sub = subdomainOf(req)!;
    // The answer takes at least FORGOT_FLOOR_MS whether or not a link is sent, so its timing doesn't tell.
    const floor = new Promise((r) => setTimeout(r, FORGOT_FLOOR_MS));
    // Per address, and per email from each network (so someone elsewhere can't use up a person's
    // links); all networks together have a higher cap, which a network the account recently signed
    // in from is not held to.
    const lower = email.toLowerCase();
    const account = `${tenantId}:${lower}`;
    if ((await allow(`forgot:${addressKey(req.ip)}:${tenantId}`, 5, 15 * 60_000)) && (await allow(`forgot:${lower}:${tenantId}:${networkKey(req.ip)}`, 3, 60 * 60_000))) {
      await withTenant(tenantId, async (tx) => {
        const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: lower } } });
        if (!user || user.status !== 'ACTIVE' || user.processingRestrictedAt) return;
        const known = isKnownNetwork(user.knownNetworks, networkId('org', account, req.ip), POLICIES.org);
        if (!known && !(await allow(`forgot:${lower}:${tenantId}`, FORGOT_PER_EMAIL, 60 * 60_000))) return;
        const token = await issueAuthToken(tx, tenantId, user.id, 'RESET');
        await tx.emailOutbox.create({
          data: { tenantId, toEmail: user.email, template: 'password_reset', locale: user.locale, params: { url: appUrl(sub, `/reset?token=${token}`) } },
        });
      });
    }
    await floor;
    res.status(202).json({ ok: true });
  }),
);

/** Completes both password resets and invitations. */
authRouter.post(
  '/auth/reset',
  h(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(100), password: passwordRule }).parse(req.body);
    const tenantId = req.tenantId!;
    if (!await allow(`reset:${addressKey(req.ip)}:${tenantId}`, 10, 15 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    await refuseBreached(body.password);
    const passwordHash = await hashPassword(body.password);
    const done = await withTenant(tenantId, async (tx) => {
      const t = await consumeAuthToken(tx, body.token, ['INVITE', 'RESET']);
      if (!t) return false;
      // Thrown inside the transaction, so a refused password leaves the link usable for another try.
      const who = await tx.user.findUniqueOrThrow({ where: { id: t.userId }, select: { email: true, firstName: true, lastName: true, tenant: { select: { name: true, subdomain: true } } } });
      checkPersonalPassword(body.password, { ...who, organization: who.tenant.name, subdomain: who.tenant.subdomain });
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, lockoutLevel: 0 } });
      // Every network's failures and locks on the account are forgotten too.
      await clearAccount('org', `${tenantId}:${who.email.toLowerCase()}`);
      await tx.refreshToken.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await notify(tx, tenantId, [{ userId: t.userId, type: t.purpose === 'INVITE' ? 'welcome' : 'password_changed', link: '/profile' }]);
      return true;
    });
    if (!done) throw new HttpError(400, 'LINK_EXPIRED', 'This link has expired or was already used. Ask for a new one.');
    res.json({ ok: true });
  }),
);
