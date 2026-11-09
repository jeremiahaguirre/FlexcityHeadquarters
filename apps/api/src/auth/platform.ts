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

export interface PlatformContext { adminId: string; email: string; name: string; signedInAt: Date; sessionId: string; mfa: boolean }

/**
 * The Dev console needs a passkey as a second factor. Always in production;
 * elsewhere PLATFORM_MFA=off turns it off (the test suite does by default).
 */
export function platformMfaRequired(): boolean {
  if (config().NODE_ENV === 'production') return true;
  return (process.env.PLATFORM_MFA ?? (config().NODE_ENV === 'test' ? 'off' : 'required')) === 'required';
}

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

/** `mfa`: the sign-in used a passkey, which is a second factor on its own. */
export async function startPlatformSession(adminId: string, mfa = false): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await db().platformSession.create({ data: { adminId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + SESSION_MS), mfaAt: mfa ? new Date() : null } });
  return raw;
}

export async function markPlatformMfa(sessionId: string): Promise<void> {
  await db().platformSession.update({ where: { id: sessionId }, data: { mfaAt: new Date() } });
}

export async function endPlatformSession(raw: string | undefined): Promise<void> {
  if (raw) await db().platformSession.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** CSRF guard for every Dev console request, signed in or not. */
export function requirePlatformHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.header(PLATFORM_HEADER) !== '1') return next(new HttpError(403, 'FORBIDDEN', 'Missing Dev console header'));
  next();
}

/**
 * Signed in, second factor or not. Only for the few routes that let someone
 * finish signing in: who am I, add a first passkey, confirm with a passkey.
 */
export async function requirePlatformSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[PLATFORM_COOKIE] as string | undefined;
    if (!raw) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console');
    const s = await db().platformSession.findUnique({ where: { tokenHash: sha256(raw) }, include: { admin: true } });
    if (!s || s.revokedAt || s.expiresAt < new Date() || s.admin.disabledAt) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expired');
    req.platform = { adminId: s.admin.id, email: s.admin.email, name: s.admin.name, signedInAt: s.createdAt, sessionId: s.id, mfa: !!s.mfaAt };
    next();
  } catch (e) {
    next(e);
  }
}

/** Signed in with both factors (when the second factor is required). */
export function requirePlatform(req: Request, res: Response, next: NextFunction) {
  void requirePlatformSession(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (platformMfaRequired() && !req.platform!.mfa) return next(new HttpError(403, 'MFA_REQUIRED', 'Confirm with your passkey to continue.'));
    next();
  });
}

export function platformOf(req: Request): PlatformContext {
  if (!req.platform) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console');
  return req.platform;
}
