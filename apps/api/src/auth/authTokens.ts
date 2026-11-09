import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokenPurpose } from '@prisma/client';
import { config } from '../config.js';
import type { Tx } from '../lib/db.js';

const TTL_MS: Record<AuthTokenPurpose, number> = { RESET: 60 * 60_000, INVITE: 7 * 86_400_000 };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Issue a one-time link token. Older unused tokens of the same purpose are retired. */
export async function issueAuthToken(tx: Tx, tenantId: string, userId: string, purpose: AuthTokenPurpose): Promise<string> {
  await tx.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomBytes(32).toString('base64url');
  await tx.authToken.create({ data: { tenantId, userId, purpose, tokenHash: sha(raw), expiresAt: new Date(Date.now() + TTL_MS[purpose]) } });
  return raw;
}

/** Returns the user id if the token is valid, and marks it used. */
export async function consumeAuthToken(tx: Tx, raw: string): Promise<{ userId: string; purpose: AuthTokenPurpose } | null> {
  const t = await tx.authToken.findUnique({ where: { tokenHash: sha(raw) } });
  if (!t || t.usedAt || t.expiresAt < new Date()) return null;
  await tx.authToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
  return { userId: t.userId, purpose: t.purpose };
}

export function appUrl(subdomain: string, path: string): string {
  return config().PUBLIC_APP_URL.replace('{subdomain}', subdomain) + path;
}
