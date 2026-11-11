import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AccessRole } from '@prisma/client';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import type { Tx } from '../lib/db.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface AccessClaims {
  sub: string; // user id
  tid: string; // tenant id
  roles: AccessRole[];
  /** When the person last proved who they are (epoch seconds). Absent = unknown, never "recent". */
  aat?: number;
  /** This session proved a second factor (a passkey, or a code by email or text). */
  mfa?: boolean;
  /** An FH support visit (SupportSession id): read-only, consent-based. */
  sup?: string;
}

const secret = () => new TextEncoder().encode(config().JWT_SECRET);

export async function signAccessToken(claims: AccessClaims, ttlSeconds?: number): Promise<string> {
  return new SignJWT({ tid: claims.tid, roles: claims.roles, ...(claims.aat ? { aat: claims.aat } : {}), ...(claims.mfa ? { mfa: true } : {}), ...(claims.sup ? { sup: claims.sup } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ttlSeconds ? `${ttlSeconds}s` : `${config().ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
  if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string' || !Array.isArray(payload.roles)) {
    throw new Error('Malformed token');
  }
  return { sub: payload.sub, tid: payload.tid, roles: payload.roles as AccessRole[], aat: typeof payload.aat === 'number' ? payload.aat : undefined, mfa: payload.mfa === true, ...(typeof payload.sup === 'string' ? { sup: payload.sup } : {}) };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Issue an opaque refresh token. Only its hash is stored. */
export async function issueRefreshToken(
  tx: Tx,
  tenantId: string,
  userId: string,
  familyId: string = randomUUID(),
  authenticatedAt: Date = new Date(),
  mfaAt: Date | null = null,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await tx.refreshToken.create({
    data: {
      tenantId,
      userId,
      familyId,
      authenticatedAt,
      mfaAt,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + config().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return raw;
}

/**
 * Rotate a refresh token. Presenting an already-revoked token means it was
 * stolen and replayed: the whole family is revoked and the user must log in again.
 */
export async function rotateRefreshToken(
  tx: Tx,
  raw: string,
): Promise<{ userId: string; tenantId: string; token: string; authenticatedAt: Date; mfa: boolean } | null> {
  const existing = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!existing) return null;
  if (existing.revokedAt || existing.expiresAt < new Date()) {
    if (existing.revokedAt) {
      await tx.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return null;
  }
  await tx.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  // Rotation keeps the original sign-in time: refreshing is not proving who you are.
  const token = await issueRefreshToken(tx, existing.tenantId, existing.userId, existing.familyId, existing.authenticatedAt, existing.mfaAt);
  return { userId: existing.userId, tenantId: existing.tenantId, token, authenticatedAt: existing.authenticatedAt, mfa: !!existing.mfaAt };
}

export async function revokeRefreshFamily(tx: Tx, raw: string): Promise<void> {
  const existing = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (existing) {
    await tx.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export const epochSeconds = (d: Date = new Date()) => Math.floor(d.getTime() / 1000);

/**
 * Marks the session behind this refresh token as just re-authenticated (step-up).
 * `mfa`: it was done with a passkey or a one-time code, so the session now has a second factor.
 */
export async function markReauthenticated(tx: Tx, raw: string, at: Date = new Date(), mfa = false): Promise<void> {
  const existing = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (existing) {
    await tx.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { authenticatedAt: at, ...(mfa ? { mfaAt: at } : {}) } });
  }
}

/** Does the session behind this refresh token already have a second factor? */
export async function sessionHasMfa(tx: Tx, raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const existing = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  return !!existing?.mfaAt && !existing.revokedAt;
}
