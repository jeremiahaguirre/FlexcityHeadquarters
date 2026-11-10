import { Router } from 'express';
import { z } from 'zod';
import { appUrl, consumeAuthToken, issueAuthToken } from '../auth/authTokens.js';
import { allow } from '../auth/rateLimit.js';
import { epochSeconds, hashPassword, signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshFamily, verifyPassword } from '../auth/tokens.js';
import { config } from '../config.js';
import { withTenant } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { permissionsFor } from '../auth/permissions.js';
import { connectionFor, publicSso, ready } from '../services/auth/sso.js';
import { notify } from '../services/notifications/notifier.js';
import { h, lookupTenant, subdomainOf } from './context.js';

export const COOKIE = 'fc_refresh';
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60_000;

export const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /[^A-Za-z]/.test(p), 'Mix letters with numbers or symbols.');

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
    const { disabledAt: _closed, ...branding } = t;
    res.json({ ...branding, sso: await publicSso(t.id) });
  }),
);

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/auth/login',
  h(async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const tenantId = req.tenantId!;
    if (!await allow(`login:${req.ip}:${tenantId}`, 20, 10 * 60_000)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait a few minutes and try again.');
    }
    // The transaction returns its outcome instead of throwing, so the failed-attempt
    // counter is committed even when the sign-in is refused.
    const outcome = await withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: email.toLowerCase() } } });
      // Same error and similar timing whether or not the account exists.
      const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, 'scrypt$AAAA$AAAA').then(() => false);
      if (user?.lockedUntil && user.lockedUntil > new Date()) return { kind: 'locked' as const };
      if (!user || !ok || user.status !== 'ACTIVE' || user.processingRestrictedAt) {
        if (user && !ok) {
          const failed = user.failedLoginCount + 1;
          await tx.user.update({
            where: { id: user.id },
            data: failed >= LOCKOUT_AFTER ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { failedLoginCount: failed },
          });
        }
        return { kind: 'invalid' as const };
      }
      // Single sign-on only: passwords stay for the people who can turn it off, so nobody is locked out.
      const sso = await connectionFor(tx);
      if (ready(sso) && sso.enforced && !permissionsFor(user.roles).has('tenant.configure')) return { kind: 'sso' as const };
      if (user.failedLoginCount || user.lockedUntil) await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      const refresh = await issueRefreshToken(tx, tenantId, user.id);
      return { kind: 'ok' as const, user, refresh };
    });
    if (outcome.kind === 'locked') {
      throw new HttpError(423, 'ACCOUNT_LOCKED', 'This account is locked for 15 minutes after too many attempts. Reset your password to unlock it now.');
    }
    if (outcome.kind === 'sso') throw new HttpError(403, 'SSO_REQUIRED', 'Your organization signs in with single sign-on. Use the button above.');
    if (outcome.kind === 'invalid') throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
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

/** Always answers 202 so it can't be used to discover which emails have accounts. */
authRouter.post(
  '/auth/forgot',
  h(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const tenantId = req.tenantId!;
    const sub = subdomainOf(req)!;
    if ((await allow(`forgot:${req.ip}:${tenantId}`, 5, 15 * 60_000)) && (await allow(`forgot:${email.toLowerCase()}:${tenantId}`, 3, 60 * 60_000))) {
      await withTenant(tenantId, async (tx) => {
        const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: email.toLowerCase() } } });
        if (!user || user.status !== 'ACTIVE' || user.processingRestrictedAt) return;
        const token = await issueAuthToken(tx, tenantId, user.id, 'RESET');
        await tx.emailOutbox.create({
          data: { tenantId, toEmail: user.email, template: 'password_reset', locale: user.locale, params: { url: appUrl(sub, `/reset?token=${token}`) } },
        });
      });
    }
    res.status(202).json({ ok: true });
  }),
);

/** Completes both password resets and invitations. */
authRouter.post(
  '/auth/reset',
  h(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(100), password: passwordRule }).parse(req.body);
    const tenantId = req.tenantId!;
    if (!await allow(`reset:${req.ip}:${tenantId}`, 10, 15 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    const passwordHash = await hashPassword(body.password);
    const done = await withTenant(tenantId, async (tx) => {
      const t = await consumeAuthToken(tx, body.token, ['INVITE', 'RESET']);
      if (!t) return false;
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await notify(tx, tenantId, [{ userId: t.userId, type: t.purpose === 'INVITE' ? 'welcome' : 'password_changed', link: '/profile' }]);
      return true;
    });
    if (!done) throw new HttpError(400, 'LINK_EXPIRED', 'This link has expired or was already used. Ask for a new one.');
    res.json({ ok: true });
  }),
);
