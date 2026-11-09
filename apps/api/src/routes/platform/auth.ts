import { Router } from 'express';
import { z } from 'zod';
import { PLATFORM_COOKIE, endPlatformSession, platformCookieOpts, platformOf, requirePlatform, startPlatformSession } from '../../auth/platform.js';
import { allow } from '../../auth/rateLimit.js';
import { verifyPassword } from '../../auth/tokens.js';
import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { h } from '../context.js';

const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60_000;

export const platformAuthRouter = Router();

platformAuthRouter.post(
  '/auth/login',
  h(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    if (!await allow(`platform-login:${req.ip}`, 10, 10 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait a few minutes and try again.');
    const admin = await db().platformAdmin.findUnique({ where: { email: email.toLowerCase() } });
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : await verifyPassword(password, 'scrypt$AAAA$AAAA').then(() => false);
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) throw new HttpError(423, 'ACCOUNT_LOCKED', 'This account is locked for 15 minutes after too many attempts.');
    if (!admin || !ok || admin.disabledAt) {
      if (admin && !ok) {
        const failed = admin.failedLogins + 1;
        await db().platformAdmin.update({
          where: { id: admin.id },
          data: failed >= LOCKOUT_AFTER ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { failedLogins: failed },
        });
      }
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    await db().platformAdmin.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    res.cookie(PLATFORM_COOKIE, await startPlatformSession(admin.id), platformCookieOpts());
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
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
  requirePlatform,
  h(async (req, res) => {
    const p = platformOf(req);
    res.json({ id: p.adminId, email: p.email, name: p.name });
  }),
);
