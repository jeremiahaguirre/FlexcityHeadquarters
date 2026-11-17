/**
 * A person's sign-in email and status are their account (SEC-01, SEC-05, SEC-12, SEC-17): whoever
 * controls the email receives invitation and reset links and emailed sign-in codes.
 * - Only someone whose own access covers the person's may change them: an HR administrator for the
 *   whole organization, or an editor holding every capability the person holds. A non-HR editor
 *   can't redirect an HR administrator's or a union steward's sign-in.
 * - For an account that has signed in before (a password, a passkey or single sign-on), a new
 *   email waits for the person to confirm it from the new address. The old address is told at
 *   once, and again when it changes. A never-used account (a fresh invitation) changes directly.
 */
import type { User } from '../../generated/prisma/client.js';
import type { AuthContext } from '../../auth/middleware.js';
import { appUrl, consumeAuthToken, issueAuthToken } from '../../auth/authTokens.js';
import { audit, type Tx } from '../../lib/db.js';
import { HttpError, conflict } from '../../lib/errors.js';
import { tenantSettings } from '../platform/features.js';
import { permissionsWithOverrides } from '../platform/roleOverrides.js';
import { SUPERVISORY, isAllowedCustomPermission } from './customRoles.js';

const masked = (email: string) => email.replace(/^(.).*(@.*)$/, '$1•••$2');

/** Refuses an email or status change for someone whose access isn't covered by the editor's own. */
export async function assertMayChangeIdentity(tx: Tx, a: AuthContext, target: Pick<User, 'id' | 'roles'>) {
  if (target.id === a.userId) return;
  if (a.roles.includes('HR_ADMIN') && !a.scope) return;
  const [{ overrides }, custom] = await Promise.all([tenantSettings(a.tenantId), tx.userCustomRole.findMany({ where: { userId: target.id }, select: { customRole: { select: { permissions: true } } } })]);
  const theirs = new Set([...permissionsWithOverrides(target.roles, overrides), ...custom.flatMap((c) => c.customRole.permissions.filter(isAllowedCustomPermission))]);
  // What they can do to others (supervisory and administrator capabilities), not their own self-service.
  const beyond = [...theirs].filter((p) => SUPERVISORY.has(p) && !a.permissions.has(p));
  if (target.roles.includes('HR_ADMIN') || target.roles.includes('UNION_STEWARD') || beyond.length) {
    throw new HttpError(403, 'ACCOUNT_PROTECTED', 'Only an HR administrator for the whole organization can change this person’s sign-in email or status: their access goes beyond yours.');
  }
}

/** Whether the account has ever been used to sign in (a password, a passkey or single sign-on). */
export async function hasSignedIn(tx: Tx, u: Pick<User, 'id' | 'passwordHash' | 'ssoSubject'>) {
  return !!u.passwordHash || !!u.ssoSubject || (await tx.passkey.count({ where: { userId: u.id } })) > 0;
}

/** Applies a new sign-in email now: sessions and links end, and the old address is told. */
export async function applyEmail(tx: Tx, tenantId: string, before: Pick<User, 'id' | 'email' | 'locale'>, email: string) {
  await tx.user.update({ where: { id: before.id }, data: { email, pendingEmail: null, pendingEmailAt: null } });
  await tx.refreshToken.updateMany({ where: { userId: before.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.authToken.updateMany({ where: { userId: before.id, usedAt: null }, data: { usedAt: new Date() } });
  await tx.emailOutbox.create({ data: { tenantId, toEmail: before.email, template: 'email_changed', locale: before.locale, params: { newEmail: masked(email) } } });
}

/** Asks the person to confirm a new sign-in email from that address; tells the old one. */
export async function requestEmailChange(tx: Tx, tenantId: string, before: Pick<User, 'id' | 'email' | 'locale'>, email: string, actorId: string | null) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subdomain: true, name: true } });
  await tx.user.update({ where: { id: before.id }, data: { pendingEmail: email, pendingEmailAt: new Date() } });
  const token = await issueAuthToken(tx, tenantId, before.id, 'EMAIL_CHANGE');
  await tx.emailOutbox.create({ data: { tenantId, toEmail: email, template: 'email_change_confirm', locale: before.locale, params: { organization: tenant.name, url: appUrl(tenant.subdomain, `/confirm-email?token=${token}`) } } });
  await tx.emailOutbox.create({ data: { tenantId, toEmail: before.email, template: 'email_change_requested', locale: before.locale, params: { newEmail: masked(email) } } });
  await audit(tx, { tenantId, actorId, action: 'user.email_change_requested', entity: 'User', entityId: before.id, after: { newEmail: masked(email) } });
}

/** The person confirms from the new address: it replaces the old one. False when the link is no good. */
export async function confirmEmailChange(tx: Tx, tenantId: string, raw: string): Promise<boolean> {
  const t = await consumeAuthToken(tx, raw, ['EMAIL_CHANGE']);
  if (!t) return false;
  const u = await tx.user.findUnique({ where: { id: t.userId } });
  if (!u?.pendingEmail || u.status !== 'ACTIVE') return false;
  if (await tx.user.findFirst({ where: { email: u.pendingEmail, id: { not: u.id } }, select: { id: true } })) throw conflict('EMAIL_TAKEN', 'Someone in your organization already uses this email.', { field: 'email' });
  await applyEmail(tx, tenantId, u, u.pendingEmail);
  await audit(tx, { tenantId, actorId: u.id, action: 'user.email_change_confirmed', entity: 'User', entityId: u.id });
  return true;
}
