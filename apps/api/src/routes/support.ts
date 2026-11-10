/**
 * The organization's side of FH support access: HR allows it for a few
 * hours (set-up screens only, or everything HR sees), sees every visit, and
 * can withdraw it at any time. The support link from the Dev console lands
 * on /support, which trades its one-time code here for a read-only session.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { signAccessToken } from '../auth/tokens.js';
import { audit, db, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { redeemSupportCode } from '../services/platform/support.js';
import { h } from './context.js';

/** Mounted with the organization's sign-in routes (no session yet). */
export const supportAuthRouter = Router();
supportAuthRouter.post(
  '/auth/support',
  h(async (req, res) => {
    const tenantId = req.tenantId!;
    const { code } = z.object({ code: z.string().min(20).max(80) }).parse(req.body);
    const { session, grant, admin } = await redeemSupportCode(tenantId, code);
    const granter = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id: grant.grantedById }, select: { id: true, roles: true, status: true } }));
    if (!granter || granter.status !== 'ACTIVE') throw forbidden('The person who allowed support access is no longer active.');
    const ttl = Math.max(60, Math.floor((session.endsAt.getTime() - Date.now()) / 1000));
    const accessToken = await signAccessToken({ sub: granter.id, tid: tenantId, roles: grant.level === 'FULL' ? granter.roles : ['HR_ADMIN'], mfa: true, sup: session.id }, ttl);
    await withTenant(tenantId, (tx) => audit(tx, { tenantId, actorId: null, action: 'support.session.start', entity: 'SupportSession', entityId: session.id, after: { admin: admin.name, level: grant.level, endsAt: session.endsAt } }));
    res.json({ accessToken, support: { admin: admin.name, level: grant.level, endsAt: session.endsAt } });
  }),
);

/** Mounted with the signed-in routes. */
export const supportRouter = Router();
const uuid = z.string().uuid();

supportRouter.get(
  '/support-access',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const grants = await withTenant(a.tenantId, (tx) => tx.supportGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }));
    const sessions = await db().supportSession.findMany({ where: { tenantId: a.tenantId, usedAt: { not: null } }, orderBy: { usedAt: 'desc' }, take: 50 });
    const admins = await db().platformAdmin.findMany({ where: { id: { in: [...new Set(sessions.map((s) => s.adminId))] } }, select: { id: true, name: true } });
    const people = await withTenant(a.tenantId, (tx) => tx.user.findMany({ where: { id: { in: [...new Set(grants.map((g) => g.grantedById))] } }, select: { id: true, firstName: true, lastName: true } }));
    const now = new Date();
    res.json({
      grants: grants.map((g) => ({ id: g.id, level: g.level, reason: g.reason, expiresAt: g.expiresAt, revokedAt: g.revokedAt, createdAt: g.createdAt, active: !g.revokedAt && g.expiresAt > now, grantedBy: people.find((p) => p.id === g.grantedById) ? `${people.find((p) => p.id === g.grantedById)!.firstName} ${people.find((p) => p.id === g.grantedById)!.lastName}` : null })),
      visits: sessions.map((s) => ({ id: s.id, admin: admins.find((x) => x.id === s.adminId)?.name ?? 'FH support', startedAt: s.usedAt, endsAt: s.endsAt })),
    });
  }),
);

supportRouter.post(
  '/support-access',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.support) throw forbidden('Support can’t grant itself access.');
    const b = z.object({ hours: z.number().int().min(1).max(72), level: z.enum(['SETUP', 'FULL']), reason: z.string().trim().max(200).nullable().optional() }).parse(req.body);
    const g = await withTenant(a.tenantId, async (tx) => {
      // One permission at a time: a new one replaces the old.
      await tx.supportGrant.updateMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      const g = await tx.supportGrant.create({ data: { tenantId: a.tenantId, grantedById: a.userId, level: b.level, reason: b.reason ?? null, expiresAt: new Date(Date.now() + b.hours * 3_600_000) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'support.grant', entity: 'SupportGrant', entityId: g.id, after: b });
      return g;
    });
    res.status(201).json({ id: g.id, expiresAt: g.expiresAt });
  }),
);

supportRouter.delete(
  '/support-access/:id',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const g = await tx.supportGrant.findUnique({ where: { id } });
      if (!g || g.revokedAt) throw notFound('Permission');
      await tx.supportGrant.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'support.revoke', entity: 'SupportGrant', entityId: id });
    });
    res.json({ ok: true });
  }),
);
