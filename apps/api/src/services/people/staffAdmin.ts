/**
 * Adding people, changing their record and starting their offboarding: the rules HR's screens and
 * the public API share (routes/staff.ts, routes/hr.ts, routes/publicApi.ts).
 *
 * - Nobody gives out more access than they hold (assertCanGrant).
 * - Emails, employee numbers and external ids are unique in the organization (409 with the field).
 * - A new sign-in email ends the person's sessions and tells the old address.
 * - Ending someone's employment never deletes them: offboarding records the last day and HR
 *   finishes its checklist; the record and its history stay.
 */
import type { AccessRole, EmploymentStatus, Prisma, UserStatus } from '../../generated/prisma/client.js';
import { appUrl, issueAuthToken } from '../../auth/authTokens.js';
import type { AuthContext } from '../../auth/middleware.js';
import { permissionsFor } from '../../auth/permissions.js';
import { audit, type Tx } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { forgetActive, setUserCustomRoles } from './customRoles.js';
import { setManagers, setReportsOf } from './reporting.js';
import { actorOf } from './scope.js';

/**
 * Nobody gives out more than they hold: outside HR for the whole organization, every permission of
 * the roles being given must already be the actor's own; HR administrator can only be given by such
 * an HR administrator; and nobody changes their own roles.
 */
export function assertCanGrant(a: AuthContext, roles: readonly AccessRole[], targetId: string | null) {
  if (targetId && targetId === a.userId) throw forbidden('You can’t change your own roles. Ask another administrator.');
  if (roles.includes('HR_ADMIN') && (!a.roles.includes('HR_ADMIN') || a.scope)) throw forbidden('Only an HR administrator for the whole organization can give the HR administrator role.');
  // HR for the whole organization assigns any role; everyone else only within their own access.
  if (a.roles.includes('HR_ADMIN') && !a.scope) return;
  const missing = [...permissionsFor(roles)].filter((p) => !a.permissions.has(p));
  if (missing.length) throw forbidden('You can’t give a role with more access than your own.');
}

/** "2026-05-01" → a date; null stays null; undefined (left out) stays undefined. */
export const dateOnly = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : s === null ? null : undefined);

/** Refuses an email, employee number or external id another person in the organization already has. */
async function assertUnique(tx: Tx, id: string | null, f: { email?: string; employeeNumber?: string | null; externalId?: string | null }) {
  const not = id ? { id: { not: id } } : {};
  if (f.email && (await tx.user.findFirst({ where: { email: f.email.toLowerCase(), ...not }, select: { id: true } }))) throw conflict('EMAIL_TAKEN', 'Someone in your organization already uses this email.', { field: 'email' });
  if (f.employeeNumber && (await tx.user.findFirst({ where: { employeeNumber: f.employeeNumber, ...not }, select: { id: true } }))) throw conflict('EMPLOYEE_NUMBER_TAKEN', 'Someone in your organization already has this employee number.', { field: 'employee_number' });
  if (f.externalId && (await tx.user.findFirst({ where: { externalId: f.externalId, ...not }, select: { id: true } }))) throw conflict('EXTERNAL_ID_TAKEN', 'Someone in your organization already has this external id.', { field: 'external_id' });
}

/** Position ids must be this organization's (row-level security hides others). */
async function assertPositions(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length && (await tx.position.count({ where: { id: { in: unique } } })) !== unique.length) throw new HttpError(400, 'UNKNOWN_POSITION', 'Unknown position.', { field: 'position_ids' });
  return unique;
}

export interface NewPerson {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  email: string;
  phone?: string | null;
  roles: AccessRole[];
  employmentStatus: EmploymentStatus;
  locale: string;
  hireDate?: string | null;
  dateOfBirth?: string | null;
  employeeNumber?: string | null;
  externalId?: string | null;
  positionIds: string[];
  customRoleIds: string[];
  managerId?: string | null;
}

/**
 * Adds a person. With `invite`, emails them a link to set a password (valid 7 days); without, the
 * record has no sign-in until HR sends the invitation (as with a spreadsheet import).
 */
export async function createPerson(tx: Tx, a: AuthContext, body: NewPerson, opts: { invite: boolean; subdomain: string; audit?: unknown }) {
  assertCanGrant(a, body.roles, null);
  await assertUnique(tx, null, body);
  const positionIds = await assertPositions(tx, body.positionIds);
  const created = await tx.user.create({
    data: {
      tenantId: a.tenantId,
      firstName: body.firstName,
      lastName: body.lastName,
      preferredName: body.preferredName ?? null,
      email: body.email.toLowerCase(),
      phone: body.phone ?? null,
      roles: body.roles,
      employmentStatus: body.employmentStatus,
      locale: body.locale,
      hireDate: dateOnly(body.hireDate) ?? null,
      seniorityDate: dateOnly(body.hireDate) ?? null,
      dateOfBirth: dateOnly(body.dateOfBirth) ?? null,
      employeeNumber: body.employeeNumber ?? null,
      externalId: body.externalId ?? null,
    },
  });
  if (positionIds.length) await tx.userPosition.createMany({ data: positionIds.map((positionId) => ({ tenantId: a.tenantId, userId: created.id, positionId })) });
  if (body.customRoleIds.length) await setUserCustomRoles(tx, a.tenantId, created.id, body.customRoleIds, actorOf(a));
  if (body.managerId) await setManagers(tx, a, a.tenantId, [created.id], body.managerId);
  if (opts.invite) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    const token = await issueAuthToken(tx, a.tenantId, created.id, 'INVITE');
    await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: created.email, template: 'invite', locale: created.locale, params: { organization: tenant.name, url: appUrl(opts.subdomain, `/reset?token=${token}&invite=1`) } } });
  }
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'user.create', entity: 'User', entityId: created.id, after: opts.audit ?? { ...body, invited: opts.invite } });
  return created;
}

export interface PersonChange {
  firstName?: string;
  lastName?: string;
  preferredName?: string | null;
  email?: string;
  phone?: string | null;
  roles?: AccessRole[];
  status?: UserStatus;
  employmentStatus?: EmploymentStatus;
  hireDate?: string | null;
  seniorityDate?: string | null;
  seniorityHours?: string;
  vscClearedDate?: string | null;
  dateOfBirth?: string | null;
  employeeNumber?: string | null;
  externalId?: string | null;
  unionMember?: boolean;
  customRoleIds?: string[];
  /** Replaces the positions they hold. */
  positionIds?: string[];
  /** Who they report to (null: their department's manager). */
  managerId?: string | null;
}

/** Changes a person's record. Only what's given changes. */
export async function updatePerson(tx: Tx, a: AuthContext, id: string, change: PersonChange) {
  const { customRoleIds, positionIds, managerId, ...body } = change;
  if (body.roles) {
    if (id === a.userId && !body.roles.includes('HR_ADMIN') && a.roles.includes('HR_ADMIN')) throw badRequest('You cannot remove your own HR administrator role.');
    // Keeping your own roles exactly as they are is fine; changing them isn't.
    if (!(id === a.userId && [...body.roles].sort().join() === [...a.roles].sort().join())) assertCanGrant(a, body.roles, id);
  }
  const before = await tx.user.findUnique({ where: { id } });
  if (!before || before.anonymizedAt) throw notFound('Staff member');
  await assertUnique(tx, id, body);
  const data: Prisma.UserUpdateInput = {
    ...body,
    email: body.email?.toLowerCase(),
    hireDate: dateOnly(body.hireDate),
    seniorityDate: dateOnly(body.seniorityDate),
    vscClearedDate: dateOnly(body.vscClearedDate),
    dateOfBirth: dateOnly(body.dateOfBirth),
  };
  // An account's roles can't be raised past the editor's own, even if they hold it already.
  if (body.roles && before.roles.includes('HR_ADMIN') && !body.roles.includes('HR_ADMIN') && (!a.roles.includes('HR_ADMIN') || a.scope)) throw forbidden('Only an HR administrator can change another HR administrator’s roles.');
  await tx.user.update({ where: { id }, data });
  if (customRoleIds) await setUserCustomRoles(tx, a.tenantId, id, customRoleIds, actorOf(a));
  if (positionIds) {
    const wanted = await assertPositions(tx, positionIds);
    await tx.userPosition.deleteMany({ where: { userId: id, positionId: { notIn: wanted } } });
    const held = new Set((await tx.userPosition.findMany({ where: { userId: id }, select: { positionId: true } })).map((p) => p.positionId));
    const add = wanted.filter((p) => !held.has(p));
    if (add.length) await tx.userPosition.createMany({ data: add.map((positionId) => ({ tenantId: a.tenantId, userId: id, positionId })) });
  }
  if (managerId !== undefined) await setManagers(tx, a, a.tenantId, [id], managerId);
  // A new sign-in email: sessions end, and the old address is told (an account can't be quietly redirected).
  const emailChanged = body.email && body.email.toLowerCase() !== before.email;
  if (emailChanged) {
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: before.email, template: 'email_changed', locale: before.locale, params: { newEmail: body.email!.toLowerCase().replace(/^(.).*(@.*)$/, '$1•••$2') } } });
  }
  if (body.status && body.status !== 'ACTIVE') {
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    forgetActive(id);
  }
  // Ended without offboarding: their people move up to the leaver's own manager (or their department's).
  if (body.status === 'TERMINATED' && before.status !== 'TERMINATED') {
    const reports = await setReportsOf(tx, id);
    if (reports.length) await setManagers(tx, null, a.tenantId, reports.map((r) => r.id), before.reportsToId && before.reportsToId !== id ? before.reportsToId : null).catch(() => setManagers(tx, null, a.tenantId, reports.map((r) => r.id), null));
  }
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'user.update', entity: 'User', entityId: id, before: { roles: before.roles, status: before.status }, after: { ...body, customRoleIds, positionIds, managerId } });
  return before;
}

/* ---------- Offboarding ---------- */

export const OFFBOARD_ITEMS = ['finalPay', 'vacationPayout', 'roe', 'benefitsEnded', 'equipmentReturned', 'accessRemoved', 'exitInterview'] as const;
export const OFFBOARD_REASONS = ['RESIGNATION', 'RETIREMENT', 'END_OF_SEASON', 'END_OF_CONTRACT', 'DISMISSAL', 'LAYOFF', 'OTHER'] as const;

/** Starts someone's offboarding: their last day and why, and HR's checklist. Nothing is deleted. */
export async function startOffboarding(tx: Tx, a: AuthContext, userId: string, b: { lastDay: string; reason: (typeof OFFBOARD_REASONS)[number] }) {
  if (userId === a.userId) throw forbidden('Someone else has to offboard you.');
  const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, anonymizedAt: true, status: true } });
  if (!u || u.anonymizedAt) throw notFound('Staff member');
  if (await tx.offboarding.findUnique({ where: { userId } })) throw conflict('ALREADY_OFFBOARDING', 'This person is already being offboarded.');
  const created = await tx.offboarding.create({ data: { tenantId: a.tenantId, userId, lastDay: new Date(b.lastDay), reason: b.reason, checklist: OFFBOARD_ITEMS.map((key) => ({ key, done: false, doneAt: null, doneById: null })), createdById: a.userId } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'offboarding.start', entity: 'User', entityId: userId, after: b });
  return created;
}
