/**
 * FH support access, only with the organization's consent.
 *
 * - HR grants it for a few hours, choosing what support may see: set-up
 *   screens only, or everything HR sees. HR can revoke it at any time.
 * - From the Dev console (after a passkey check) an FH admin opens a visit:
 *   a one-time code, good for two minutes, exchanged in the city's app for a
 *   read-only session of at most 30 minutes (never past the grant).
 * - Support sessions can't change anything (GET only), and every page they
 *   open is in the organization's audit log, attributed to FH support.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SupportLevel } from '../../generated/prisma/client.js';
import type { Permission } from '../../auth/permissions.js';
import { db, withTenant } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const SUPPORT_SESSION_MS = 30 * 60_000;
const CODE_MS = 2 * 60_000;

/** What a SETUP-level visit can see: how the organization is configured, not people's records. */
export const SETUP_PERMISSIONS: Permission[] = ['tenant.configure', 'ops.configure', 'roles.manage', 'positions.manage', 'schedule.read', 'billing.manage', 'onboarding.configure', 'coverage.manage', 'fees.manage', 'lessons.plan'] as Permission[];

export async function activeGrant(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.supportGrant.findFirst({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: 'desc' } }));
}

/** Console: start a visit. Returns the one-time code for the city's /support page. */
export async function startSupportVisit(tenantId: string, adminId: string) {
  const grant = await activeGrant(tenantId);
  if (!grant) throw new HttpError(409, 'NO_CONSENT', 'The organization hasn’t allowed support access, or its permission has ended. Ask their HR to allow it in Settings.');
  const code = randomBytes(24).toString('base64url');
  const endsAt = new Date(Math.min(Date.now() + SUPPORT_SESSION_MS, grant.expiresAt.getTime()));
  const s = await db().supportSession.create({ data: { tenantId, grantId: grant.id, adminId, codeHash: sha256(code), codeExpiresAt: new Date(Date.now() + CODE_MS), endsAt } });
  return { code, sessionId: s.id, endsAt, level: grant.level };
}

/** City app: trade the code for a support session (once, within two minutes, while the grant stands). */
export async function redeemSupportCode(tenantId: string, code: string) {
  const s = await db().supportSession.findUnique({ where: { codeHash: sha256(code) } });
  if (!s || s.tenantId !== tenantId || s.usedAt || s.codeExpiresAt < new Date()) throw new HttpError(401, 'SUPPORT_CODE_INVALID', 'This support link has expired or was already used.');
  const grant = await activeGrant(tenantId);
  if (!grant || grant.id !== s.grantId) throw new HttpError(401, 'NO_CONSENT', 'The organization’s permission for support access has ended.');
  await db().supportSession.update({ where: { id: s.id }, data: { usedAt: new Date() } });
  const admin = await db().platformAdmin.findUniqueOrThrow({ where: { id: s.adminId }, select: { name: true, email: true } });
  return { session: s, grant, admin };
}

/** Each support request: the grant must still stand (HR can revoke mid-visit). */
export async function supportStillAllowed(tenantId: string, sessionId: string): Promise<{ level: SupportLevel; endsAt: Date; adminId: string } | null> {
  const s = await db().supportSession.findUnique({ where: { id: sessionId } });
  if (!s || s.tenantId !== tenantId || s.endsAt < new Date()) return null;
  const grant = await withTenant(tenantId, (tx) => tx.supportGrant.findUnique({ where: { id: s.grantId } }));
  if (!grant || grant.revokedAt || grant.expiresAt < new Date()) return null;
  return { level: grant.level, endsAt: s.endsAt, adminId: s.adminId };
}
