/**
 * FH Dev console sessions. Deliberately separate from organization sign-in:
 * - opaque, revocable session tokens (only the hash is stored), in an HTTP-only,
 *   SameSite=Strict cookie scoped to /api/platform;
 * - every request must also carry the `x-fh-platform: 1` header, which a
 *   cross-site form or link can't add;
 * - organization access tokens are never accepted here, and these sessions are
 *   never accepted by organization routes.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';

export const PLATFORM_COOKIE = 'fh_platform';
export const PLATFORM_HEADER = 'x-fh-platform';
const SESSION_MS = 8 * 3_600_000;

export interface PlatformContext { adminId: string; email: string; name: string; signedInAt: Date }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platform?: PlatformContext;
    }
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const platformCookieOpts = () => ({
  httpOnly: true,
  secure: config().NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/platform',
  maxAge: SESSION_MS,
});

export async function startPlatformSession(adminId: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await db().platformSession.create({ data: { adminId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + SESSION_MS) } });
  return raw;
}

export async function endPlatformSession(raw: string | undefined): Promise<void> {
  if (raw) await db().platformSession.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** CSRF guard for every Dev console request, signed in or not. */
export function requirePlatformHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.header(PLATFORM_HEADER) !== '1') return next(new HttpError(403, 'FORBIDDEN', 'Missing Dev console header'));
  next();
}

export async function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[PLATFORM_COOKIE] as string | undefined;
    if (!raw) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console');
    const s = await db().platformSession.findUnique({ where: { tokenHash: sha256(raw) }, include: { admin: true } });
    if (!s || s.revokedAt || s.expiresAt < new Date() || s.admin.disabledAt) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expired');
    req.platform = { adminId: s.admin.id, email: s.admin.email, name: s.admin.name, signedInAt: s.createdAt };
    next();
  } catch (e) {
    next(e);
  }
}

export function platformOf(req: Request): PlatformContext {
  if (!req.platform) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console');
  return req.platform;
}
