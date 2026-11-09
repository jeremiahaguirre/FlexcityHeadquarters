import { Router } from 'express';
import { z } from 'zod';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshFamily, verifyPassword } from '../auth/tokens.js';
import { config } from '../config.js';
import { withTenant } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { h, lookupTenant, subdomainOf } from './context.js';

const COOKIE = 'fc_refresh';

const cookieOpts = () => ({
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
    res.json(t);
  }),
);

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/auth/login',
  h(async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const tenantId = req.tenantId!;
    const result = await withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: email.toLowerCase() } } });
      // Same error and similar timing whether or not the account exists.
      const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, 'scrypt$AAAA$AAAA').then(() => false);
      if (!user || !ok || user.status !== 'ACTIVE' || user.processingRestrictedAt) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      const refresh = await issueRefreshToken(tx, tenantId, user.id);
      return { user, refresh };
    });
    const accessToken = await signAccessToken({ sub: result.user.id, tid: tenantId, roles: result.user.roles });
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
    res.json({ accessToken: await signAccessToken({ sub: rotated.userId, tid: tenantId, roles: rotated.roles }) });
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
