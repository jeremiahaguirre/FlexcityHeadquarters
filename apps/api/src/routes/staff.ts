/** People and their certifications: a person's own profile and password, positions, and the staff list HR manages. */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { consentRequired } from './consent.js';
import { z } from 'zod';
import { appUrl, issueAuthToken } from '../auth/authTokens.js';
import { authOf, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { hashPassword, verifyPassword } from '../auth/tokens.js';
import { allow } from '../auth/rateLimit.js';
import { refuseBreached } from '../auth/breachedPasswords.js';
import { audit, withTenant } from '../lib/db.js';
import { db as rootDb } from '../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { addDays } from '../lib/time.js';
import { checkPersonalPassword, passwordRule } from './auth.js';
import { h, subdomainOf } from './context.js';
import { FEATURES, type FeatureKey, tenantSettings } from '../services/platform/features.js';
import { MENU } from '../auth/menu.js';
import { permissionsWithOverrides } from '../services/platform/roleOverrides.js';
import { hiddenMenuFor, parseOverrides } from '../services/platform/roleOverrides.js';
import { assertUserInScope, peopleWhere } from '../services/people/scope.js';
import { allOf, departmentFilter, departmentQuery, forget as forgetDepartmentScope } from '../services/people/departmentAdmin.js';
import { positionBody, savePosition } from '../services/people/positionAdmin.js';
import { createPerson, updatePerson } from '../services/people/staffAdmin.js';
import { adultConfirmationView, confirmAdult, removeAdultConfirmation } from '../services/people/adultConfirmation.js';

export const staffRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roles = z.array(z.enum(['HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD', 'STAFF', 'FRONT_DESK', 'UNION_STEWARD', 'EMPLOYEE'])).min(1);
const d = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : s === null ? null : undefined);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

const certInclude = { certification: { select: { id: true, name: true, nameFr: true, issuingBody: true } } } as const;
type CertRow = Prisma.UserCertificationGetPayload<{ include: typeof certInclude }>;
const certView = (c: CertRow) => ({
  id: c.id,
  certification: c.certification,
  issueDate: iso(c.issueDate),
  expiryDate: iso(c.expiryDate),
  verified: c.verifiedAt !== null,
  documentUrl: c.documentUrl,
});

// --------------------------------------------------------------------- Me
staffRouter.get(
  '/me',
  h(async (req, res) => {
    const a = authOf(req);
    const closed = await tenantSettings(a.tenantId);
    const [me, tenant, myRoles] = await withTenant(a.tenantId, (tx) =>
      Promise.all([
        tx.user.findUniqueOrThrow({
          where: { id: a.userId },
          include: { positions: { include: { position: { select: { id: true, name: true, nameFr: true } } } }, certifications: { include: certInclude } },
        }),
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { features: true, roleOverrides: true, timeFormat: true } }),
        tx.userCustomRole.findMany({ where: { userId: a.userId }, include: { customRole: { select: { id: true, name: true, nameFr: true } } } }),
      ]),
    );
    const { features, billing } = await tenantSettings(a.tenantId);
    const mustSign = a.support ? false : await withTenant(a.tenantId, (tx) => consentRequired(tx, a.userId));
    // For whoever handles billing: screens their roles would have if the plan included them.
    const lockedMenu = a.permissions.has('billing.manage')
      ? MENU.flatMap((m) => {
          if (m.permissions.some((p) => a.permissions.has(p))) return []; // already open to them
          const addOn = (Object.keys(billing.locked) as FeatureKey[]).find((f) =>
            (FEATURES[f].permissions as readonly string[]).some((p) => m.permissions.includes(p as never) && permissionsWithOverrides(me.roles, parseOverrides(tenant.roleOverrides)).has(p as never)),
          );
          return addOn ? [{ href: m.href, key: m.key, group: m.group, addOn: billing.locked[addOn]! }] : [];
        })
      : [];
    // Switched-off features are already gone from a.permissions. The Union Hub
    // follows membership, not employer roles: members see it too.
    const permissions = new Set(a.permissions);
    if (features.union && me.unionMember && !a.support) permissions.add('union.hub');
    // An FH support visit shows as support, not as the person who allowed it.
    if (a.support) {
      const admin = await rootDb().platformAdmin.findUnique({ where: { id: a.support.adminId }, select: { name: true } });
      res.json({ id: me.id, firstName: 'FH', lastName: 'support', email: '', phone: null, locale: me.locale, timeFormat: tenant.timeFormat, roles: me.roles, customRoles: [], permissions: [...permissions].filter((p) => p !== 'union.hub').sort(), features, hiddenMenu: [], employmentStatus: me.employmentStatus, positions: [], certifications: [], mfaRequired: false, lockedMenu: [], billing: { stage: billing.stage, overdueSince: billing.overdueSince, suspendsOn: billing.suspendsOn, trialEndsAt: billing.trialEndsAt, canPay: false }, support: { admin: admin?.name ?? 'FH support', level: a.support.level, endsAt: a.support.endsAt } });
      return;
    }
    res.json({
      id: me.id,
      firstName: me.firstName,
      lastName: me.lastName,
      email: me.email,
      phone: me.phone,
      locale: me.locale,
      timeFormat: tenant.timeFormat,
      roles: me.roles,
      customRoles: myRoles.map((r) => r.customRole),
      permissions: [...permissions].sort(),
      features,
      // Menu items the city's Dev console hid for every one of this person's roles.
      hiddenMenu: hiddenMenuFor(me.roles, parseOverrides(tenant.roleOverrides)),
      employmentStatus: me.employmentStatus,
      positions: me.positions.map((p) => p.position),
      certifications: me.certifications.map(certView),
      // The city requires a passkey for this access level and this session hasn't used one.
      mfaRequired: a.mfaPending,
      consentRequired: mustSign,
      // Limited to some departments, positions or facilities: whole-organization screens (payroll documents, settings) don't apply.
      scoped: !!a.scope,
      lockedMenu,
      billing: { stage: billing.stage, overdueSince: billing.overdueSince, suspendsOn: billing.suspendsOn, trialEndsAt: billing.trialEndsAt, canPay: a.permissions.has('billing.manage') },
      // Offboarded: the app shows only the data export.
      ...(closed.disabledAt ? { closed: { exportUntil: closed.exportUntil } } : {}),
    });
  }),
);

staffRouter.patch(
  '/me',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ phone: z.string().max(30).nullable().optional(), locale: z.enum(['en-CA', 'fr-CA']).optional() }).parse(req.body);
    await withTenant(a.tenantId, (tx) => tx.user.update({ where: { id: a.userId }, data: body }));
    res.json({ ok: true });
  }),
);

staffRouter.post(
  '/me/password',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ currentPassword: z.string().min(1), newPassword: passwordRule }).parse(req.body);
    // A stolen session must not become a way to guess the current password.
    if (!(await allow(`pw-change:${a.userId}`, 10, 15 * 60_000))) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    await refuseBreached(body.newPassword);
    const hash = await hashPassword(body.newPassword);
    const ok = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, include: { tenant: { select: { name: true, subdomain: true } } } });
      if (!u.passwordHash || !(await verifyPassword(body.currentPassword, u.passwordHash))) return false;
      if (body.newPassword === body.currentPassword) throw new HttpError(400, 'PASSWORD_REUSED', 'Choose a password different from your current one.');
      checkPersonalPassword(body.newPassword, { ...u, organization: u.tenant.name, subdomain: u.tenant.subdomain });
      await tx.user.update({ where: { id: a.userId }, data: { passwordHash: hash } });
      return true;
    });
    if (!ok) throw new HttpError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.');
    res.json({ ok: true });
  }),
);

/** Staff add their own certifications; they count once a supervisor verifies them. */
staffRouter.post(
  '/me/certifications',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ certificationId: uuid, issueDate: isoDate, expiryDate: isoDate.nullable(), documentUrl: z.string().url().nullable().optional() }).parse(req.body);
    if (body.expiryDate && body.expiryDate <= body.issueDate) throw badRequest('Expiry must be after the issue date.');
    const c = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.userCertification.create({
        data: { tenantId: a.tenantId, userId: a.userId, certificationId: body.certificationId, issueDate: d(body.issueDate)!, expiryDate: d(body.expiryDate) ?? null, documentUrl: body.documentUrl ?? null },
        include: certInclude,
      });
      const verifiers = await tx.user.findMany({ where: { roles: { hasSome: ['AQUATIC_SUPERVISOR'] }, status: 'ACTIVE' }, select: { id: true } });
      for (const v of verifiers) {
        await tx.notification.create({ data: { tenantId: a.tenantId, userId: v.id, type: 'cert_to_verify', params: { userCertificationId: created.id }, link: '/manage/staff' } });
      }
      return created;
    });
    res.status(201).json(certView(c));
  }),
);

// ------------------------------------------------------- Certifications
staffRouter.get(
  '/certifications',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => tx.certification.findMany({ orderBy: { name: 'asc' } })));
  }),
);

staffRouter.post(
  '/certifications',
  requirePermission('positions.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ name: z.string().min(2).max(120), nameFr: z.string().max(120).nullable().optional(), issuingBody: z.string().min(2).max(120), validityMonths: z.number().int().min(1).max(120).nullable() }).parse(req.body);
    res.status(201).json(await withTenant(a.tenantId, (tx) => tx.certification.create({ data: { ...body, tenantId: a.tenantId } })));
  }),
);

staffRouter.post(
  '/user-certifications/:id/verify',
  requirePermission('certs.verify'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const c = await withTenant(a.tenantId, async (tx) => {
      const row = await tx.userCertification.findUnique({ where: { id } });
      if (!row) throw notFound('Certification');
      if (row.userId === a.userId) throw forbidden('You cannot verify your own certification.');
      await assertUserInScope(tx, a, row.userId);
      const updated = await tx.userCertification.update({ where: { id }, data: { verifiedById: a.userId, verifiedAt: new Date() }, include: certInclude });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'cert.verify', entity: 'UserCertification', entityId: id });
      await tx.notification.create({ data: { tenantId: a.tenantId, userId: row.userId, type: 'cert_verified', params: { name: updated.certification.name }, link: '/profile' } });
      return updated;
    });
    res.json(certView(c));
  }),
);

/** Certifications staff entered themselves, waiting for a supervisor to check the card. */
staffRouter.get(
  '/certifications/unverified',
  requirePermission('certs.verify'),
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.userCertification.findMany({
        where: { verifiedAt: null, user: { status: 'ACTIVE', anonymizedAt: null, ...peopleWhere(a.scope) }, userId: { not: a.userId } },
        include: { ...certInclude, user: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { issueDate: 'desc' },
      }),
    );
    res.json(rows.map((c) => ({ ...certView(c), user: { id: c.user.id, name: `${c.user.firstName} ${c.user.lastName}` } })));
  }),
);

staffRouter.get(
  '/certifications/expiring',
  requirePermission('certs.verify'),
  h(async (req, res) => {
    const a = authOf(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query);
    const limit = new Date(Date.now() + days * 86_400_000);
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.userCertification.findMany({
        where: { expiryDate: { not: null, lte: limit }, user: { status: 'ACTIVE', anonymizedAt: null, ...peopleWhere(a.scope) } },
        include: { ...certInclude, user: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { expiryDate: 'asc' },
      }),
    );
    res.json(rows.map((c) => ({ ...certView(c), user: { id: c.user.id, name: `${c.user.firstName} ${c.user.lastName}` }, expired: c.expiryDate! < new Date() })));
  }),
);

// -------------------------------------------------------------- Positions

staffRouter.post(
  '/positions',
  requirePermission('positions.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = positionBody.parse(req.body);
    const p = await withTenant(a.tenantId, async (tx) => {
      const pos = await savePosition(tx, a.tenantId, null, { ...body, nameFr: body.nameFr ?? null, minimumAge: body.minimumAge ?? null });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'position.create', entity: 'Position', entityId: pos.id, after: body });
      return pos;
    });
    forgetDepartmentScope(a.tenantId);
    res.status(201).json(p);
  }),
);

staffRouter.put(
  '/positions/:id',
  requirePermission('positions.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = positionBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await savePosition(tx, a.tenantId, id, { ...body, nameFr: body.nameFr ?? null, minimumAge: body.minimumAge ?? null });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'position.update', entity: 'Position', entityId: id, after: body });
    });
    forgetDepartmentScope(a.tenantId);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ Staff
staffRouter.get(
  '/users',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(), q: z.string().max(80).optional(), department: departmentQuery }).parse(req.query);
    const where: Prisma.UserWhereInput = {
      anonymizedAt: null,
      // A department supervisor sees their own crew; HR can pick one department at a time.
      ...allOf(peopleWhere(a.scope), departmentFilter(q.department)),
      ...(q.status ? { status: q.status } : { status: { not: 'TERMINATED' } }),
      ...(q.q ? { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [users, assigned] = await withTenant(a.tenantId, (tx) =>
      Promise.all([
        tx.user.findMany({
          where,
          include: { positions: { include: { position: { select: { id: true, name: true, nameFr: true, departmentId: true } } } }, certifications: { select: { expiryDate: true, verifiedAt: true } } },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
        tx.userCustomRole.findMany({ include: { customRole: { select: { id: true, name: true, nameFr: true } } } }),
      ]),
    );
    const rolesOf = (userId: string) => assigned.filter((r) => r.userId === userId).map((r) => r.customRole);
    const now = Date.now();
    res.json(
      users.map((u) => {
        const expiries = u.certifications.filter((c) => c.expiryDate).map((c) => c.expiryDate!.getTime());
        const next = expiries.length ? Math.min(...expiries) : null;
        return {
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          roles: u.roles,
          customRoles: rolesOf(u.id),
          status: u.status,
          employmentStatus: u.employmentStatus,
          shadowTier: u.shadowTier,
          positions: u.positions.map((p) => p.position),
          nextCertExpiry: next ? new Date(next).toISOString().slice(0, 10) : null,
          certAttention: next !== null && next < now + 30 * 86_400_000,
          unverifiedCerts: u.certifications.filter((c) => !c.verifiedAt).length,
          invited: !u.passwordHash,
        };
      }),
    );
  }),
);

staffRouter.get(
  '/users/:id',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const u = await withTenant(a.tenantId, (tx) =>
      tx.user.findFirst({
        where: { id, ...peopleWhere(a.scope) },
        include: {
          positions: { include: { position: { select: { id: true, name: true, nameFr: true } } } },
          certifications: { include: certInclude, orderBy: { expiryDate: 'asc' } },
          payRates: { include: { position: { select: { name: true } } }, orderBy: { effectiveFrom: 'desc' } },
        },
      }),
    );
    if (!u || u.anonymizedAt) throw notFound('Staff member');
    const customRoles = await withTenant(a.tenantId, (tx) => tx.userCustomRole.findMany({ where: { userId: id }, include: { customRole: { select: { id: true, name: true, nameFr: true } } } }));
    const canSeePay = a.permissions.has('users.write');
    res.json({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      roles: u.roles,
      status: u.status,
      employmentStatus: u.employmentStatus,
      shadowTier: u.shadowTier,
      employeeNumber: u.employeeNumber,
      hireDate: iso(u.hireDate),
      seniorityDate: iso(u.seniorityDate),
      seniorityHours: u.seniorityHours.toString(),
      weeklyMinHours: u.weeklyMinHours?.toString() ?? null,
      weeklyMaxHours: u.weeklyMaxHours?.toString() ?? null,
      // Police-check date and union membership: HR only (the steward rule is applied server-side).
      vscClearedDate: canSeePay ? iso(u.vscClearedDate) : null,
      dateOfBirth: canSeePay ? iso(u.dateOfBirth) : undefined,
      // HR's confirmation that they are of the age of majority (for rules that need it without a birth date). HR only.
      adultConfirmation: canSeePay ? await withTenant(a.tenantId, (tx) => adultConfirmationView(tx, u)) : undefined,
      // Union membership: HR, and those who write discipline records (a steward must be offered).
      unionMember: canSeePay || a.permissions.has('discipline.write') ? u.unionMember : null,
      customRoles: customRoles.map((r) => r.customRole),
      invited: !u.passwordHash,
      positions: u.positions.map((p) => p.position),
      certifications: u.certifications.map(certView),
      payRates: canSeePay
        ? u.payRates.map((r) => ({ id: r.id, position: r.position.name, positionId: r.positionId, hourlyRate: r.hourlyRate.toString(), effectiveFrom: iso(r.effectiveFrom), effectiveTo: iso(r.effectiveTo) }))
        : undefined,
    });
  }),
);

const newUser = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email().max(160),
  phone: z.string().max(30).nullable().optional(),
  roles,
  employmentStatus: z.enum(['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER']),
  locale: z.enum(['en-CA', 'fr-CA']).default('en-CA'),
  hireDate: isoDate.nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  employeeNumber: z.string().max(40).nullable().optional(),
  positionIds: z.array(uuid).max(10).default([]),
  /** The organization's own roles (water works, maintenance…). */
  customRoleIds: z.array(uuid).max(10).default([]),
});

/** Creates the account and emails an invitation to set a password (valid 7 days). */
staffRouter.post(
  '/users',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = newUser.parse(req.body);
    const sub = subdomainOf(req)!;
    const u = await withTenant(a.tenantId, (tx) => createPerson(tx, a, body, { invite: true, subdomain: sub, audit: { ...body } }));
    res.status(201).json({ id: u.id, invited: true });
  }),
);

staffRouter.post(
  '/users/:id/invite',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const sub = subdomainOf(req)!;
    await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u || u.status !== 'ACTIVE') throw notFound('Active staff member');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      const token = await issueAuthToken(tx, a.tenantId, id, 'INVITE');
      await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: u.email, template: 'invite', locale: u.locale, params: { organization: tenant.name, url: appUrl(sub, `/reset?token=${token}&invite=1`) } } });
    });
    res.status(202).json({ ok: true });
  }),
);

const hrPatch = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email().max(160),
  phone: z.string().max(30).nullable(),
  roles,
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']),
  employmentStatus: z.enum(['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER']),
  hireDate: isoDate.nullable(),
  seniorityDate: isoDate.nullable(),
  seniorityHours: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
  vscClearedDate: isoDate.nullable(),
  dateOfBirth: isoDate.nullable(),
  employeeNumber: z.string().max(40).nullable(),
  unionMember: z.boolean(),
  customRoleIds: z.array(uuid).max(10),
}).partial();

staffRouter.patch(
  '/users/:id',
  requirePermission('users.write'),
  requireRecentAuth, // roles, employment status, terminations
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = hrPatch.parse(req.body);
    await withTenant(a.tenantId, (tx) => updatePerson(tx, a, id, body));
    res.json({ ok: true });
  }),
);

/** HR confirms (or stops confirming) that someone with no birth date on file is of the age of majority or older. */
staffRouter.put(
  '/users/:id/adult-confirmation',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { note } = z.object({ note: z.string().trim().min(3).max(200) }).parse(req.body);
    res.json(await withTenant(a.tenantId, async (tx) => {
      await assertUserInScope(tx, a, id);
      return confirmAdult(tx, a, id, note);
    }));
  }),
);

staffRouter.delete(
  '/users/:id/adult-confirmation',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      await assertUserInScope(tx, a, id);
      await removeAdultConfirmation(tx, a, id);
    });
    res.json({ ok: true });
  }),
);

/** Scheduling settings supervisors own: tiers, hour targets/caps, approved positions. */
staffRouter.patch(
  '/users/:id/scheduling',
  requirePermission('users.scheduling'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const hours = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable();
    const body = z
      .object({ shadowTier: z.enum(['A_SQUAD', 'B_SQUAD', 'C_SQUAD', 'UNASSIGNED']), weeklyMinHours: hours, weeklyMaxHours: hours, positionIds: z.array(uuid).max(10) })
      .partial()
      .parse(req.body);
    if (body.weeklyMinHours && body.weeklyMaxHours && Number(body.weeklyMinHours) > Number(body.weeklyMaxHours)) throw badRequest('Weekly minimum cannot exceed the maximum.');
    await withTenant(a.tenantId, async (tx) => {
      await assertUserInScope(tx, a, id);
      const { positionIds, ...rest } = body;
      await tx.user.update({ where: { id }, data: rest });
      if (positionIds) {
        // A department supervisor approves positions in their department only; others are left as they are.
        const mine = a.scope?.positionIds.length ? a.scope.positionIds : null;
        if (mine && positionIds.some((p) => !mine.includes(p))) throw forbidden('You can only approve positions in your department.');
        await tx.userPosition.deleteMany({ where: { userId: id, positionId: { notIn: positionIds, ...(mine ? { in: mine } : {}) } } });
        for (const positionId of positionIds) {
          await tx.userPosition.upsert({ where: { userId_positionId: { userId: id, positionId } }, update: {}, create: { tenantId: a.tenantId, userId: id, positionId } });
        }
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'user.scheduling', entity: 'User', entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

/** New effective-dated rate; the previous open rate for that position ends the day before. */
staffRouter.post(
  '/users/:id/pay-rates',
  requirePermission('users.write'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = z.object({ positionId: uuid, hourlyRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/), effectiveFrom: isoDate }).parse(req.body);
    if (Number(body.hourlyRate) < 10) throw badRequest('That rate is below any Canadian minimum wage. Check the amount.');
    const rate = await withTenant(a.tenantId, async (tx) => {
      const later = await tx.payRate.findFirst({ where: { userId: id, positionId: body.positionId, effectiveFrom: { gte: d(body.effectiveFrom)! } } });
      if (later) throw conflict('RATE_EXISTS', 'A rate already starts on or after that date for this position.');
      await tx.payRate.updateMany({
        where: { userId: id, positionId: body.positionId, effectiveTo: null },
        data: { effectiveTo: d(addDays(body.effectiveFrom, -1)) },
      });
      const r = await tx.payRate.create({ data: { tenantId: a.tenantId, userId: id, positionId: body.positionId, hourlyRate: body.hourlyRate, effectiveFrom: d(body.effectiveFrom)! } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payrate.create', entity: 'PayRate', entityId: r.id, after: body });
      return r;
    });
    res.status(201).json({ id: rate.id });
  }),
);

staffRouter.post(
  '/users/:id/certifications',
  requirePermission('certs.verify'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    if (userId === a.userId) throw forbidden('Add your own certifications from your profile; another supervisor verifies them.');
    const body = z.object({ certificationId: uuid, issueDate: isoDate, expiryDate: isoDate.nullable(), documentUrl: z.string().url().nullable().optional() }).parse(req.body);
    const c = await withTenant(a.tenantId, async (tx) =>
      (await assertUserInScope(tx, a, userId), tx).userCertification.create({
        data: {
          tenantId: a.tenantId,
          userId,
          certificationId: body.certificationId,
          issueDate: d(body.issueDate)!,
          expiryDate: d(body.expiryDate) ?? null,
          documentUrl: body.documentUrl ?? null,
          verifiedById: a.userId,
          verifiedAt: new Date(),
        },
        include: certInclude,
      }),
    );
    res.status(201).json(certView(c));
  }),
);
