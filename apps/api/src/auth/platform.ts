/**
 * FH Dev console sessions. Deliberately separate from organization sign-in:
 * - opaque, revocable session tokens (only the hash is stored), in an HTTP-only,
 *   SameSite=Strict cookie scoped to /api/platform;
 * - every request must also carry the `x-fh-platform: 1` header, which a
 *   cross-site form or link can't add, and isn't marked by the browser as
 *   coming from another site or origin (Sec-Fetch-Site);
 * - signing in sets `fh_csrf`, a random double-submit token the console's pages
 *   read and echo in `x-fh-csrf`; a request carrying the cookie without the
 *   matching header is refused (platformCsrfProtection, before any body is parsed);
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

export interface PlatformContext { adminId: string; email: string; name: string; signedInAt: Date; sessionId: string; mfa: boolean; mfaAt: Date | null; /** "trust.read", "trust.manage" */ permissions: string[] }

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

/**
 * Whether a console cookie names a live session (not revoked or expired, its admin not disabled).
 * The console reads bodies over 100 kB only then: the cookie's presence alone proves nothing, and
 * an anonymous sender must not make the process parse megabytes first (SECURITY-AUDIT SEC-47).
 * One indexed lookup, only for requests that carry the console header and a session cookie.
 */
export async function isLivePlatformSession(raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const s = await db().platformSession.findUnique({ where: { tokenHash: sha256(raw) }, select: { revokedAt: true, expiresAt: true, admin: { select: { disabledAt: true } } } });
  return !!s && !s.revokedAt && s.expiresAt >= new Date() && !s.admin.disabledAt;
}

/**
 * CSRF protection for every Dev console request, signed in or not, run before the body is parsed.
 * The session cookie is SameSite=Strict; on top of that a request must
 * - carry `x-fh-platform: 1`, which a cross-site form or link can't send and a cross-origin script
 *   can't add without a CORS preflight this API never answers; and
 * - not be marked by the browser as coming from another site or origin (Fetch Metadata,
 *   Sec-Fetch-Site). Clients that send no fetch metadata (scripts, older browsers) still need the header.
 */
export function platformCsrfProtection(req: Request, _res: Response, next: NextFunction) {
  const site = req.header('sec-fetch-site');
  const refused = () => next(new HttpError(403, 'CSRF_REFUSED', 'This request didn’t come from the Dev console.'));
  if (req.header(PLATFORM_HEADER) !== '1' || (site && site !== 'same-origin' && site !== 'none')) return refused();
  // Double-submit token: a browser signed in to the console holds fh_csrf, which only the console's
  // own pages can read and echo in x-fh-csrf. A request carrying the cookie without the matching
  // header (another site riding on the browser's cookies) is refused. Clients without the cookie
  // (scripts, the test suite) rely on the header and the same-site cookie rules above.
  const csrfCookie: string | undefined = req.cookies?.fh_csrf;
  if (csrfCookie !== undefined && csrfCookie !== req.header(PLATFORM_CSRF_HEADER)) return refused();
  next();
}

/** The double-submit CSRF token (platformCsrfProtection): readable by the console's pages, never sent cross-site. */
export const PLATFORM_CSRF_COOKIE = 'fh_csrf';
export const PLATFORM_CSRF_HEADER = 'x-fh-csrf';

/** Signs the browser in: the HTTP-only session cookie, then a fresh CSRF token for the console's pages to echo. */
export function setPlatformCookies(res: Response, session: string) {
  res.cookie(PLATFORM_COOKIE, session, platformCookieOpts());
  res.cookie(PLATFORM_CSRF_COOKIE, randomBytes(24).toString('base64url'), { ...platformCookieOpts(), httpOnly: false, path: '/' });
}

export function clearPlatformCookies(res: Response) {
  res.clearCookie(PLATFORM_COOKIE, { path: '/api/platform' });
  res.clearCookie(PLATFORM_CSRF_COOKIE, { path: '/' });
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
    req.platform = { adminId: s.admin.id, email: s.admin.email, name: s.admin.name, signedInAt: s.createdAt, sessionId: s.id, mfa: !!s.mfaAt, mfaAt: s.mfaAt, permissions: s.admin.permissions };
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

const STEP_UP_MS = 10 * 60_000;
/**
 * The console's most sensitive actions (closing a city, opening a support
 * visit, bank files and PAD agreements, verifying tax tables, closing the
 * books) need a passkey confirmation from the last 10 minutes.
 */
export function requirePlatformStepUp(req: Request, _res: Response, next: NextFunction) {
  const p = req.platform;
  if (!p) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console'));
  if (!platformMfaRequired()) return next();
  if (!p.mfaAt || Date.now() - p.mfaAt.getTime() > STEP_UP_MS) return next(new HttpError(403, 'PASSKEY_STEP_UP', 'Confirm with your passkey to do this.'));
  next();
}
