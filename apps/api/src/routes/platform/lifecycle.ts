/**
 * FH Dev console: closing an organization, and support visits with its consent.
 * Every action here needs a fresh passkey confirmation and is audited twice
 * (FH's log and the organization's).
 */
import { Router } from 'express';
import { z } from 'zod';
import { appUrl } from '../../auth/authTokens.js';
import { platformOf, requirePlatformStepUp } from '../../auth/platform.js';
import { audit, db, withTenant } from '../../lib/db.js';
import { HttpError, conflict, notFound } from '../../lib/errors.js';
import { forgetFeatures } from '../../services/platform/features.js';
import { activeGrant, startSupportVisit } from '../../services/platform/support.js';
import { forgetTenantLookup, h } from '../context.js';

export const lifecycleRouter = Router();
const uuid = z.string().uuid();

async function record(adminId: string, tenantId: string, action: string, detail?: object) {
  await db().platformAudit.create({ data: { adminId, tenantId, action, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });
  await withTenant(tenantId, (tx) => audit(tx, { tenantId, actorId: null, action: `fh.${action}`, entity: 'Tenant', entityId: tenantId, after: detail ?? {} }));
}

async function tenantOr404(id: string) {
  const t = await withTenant(id, (tx) => tx.tenant.findUnique({ where: { id }, select: { id: true, subdomain: true, name: true, disabledAt: true, disabledReason: true, offboardedAt: true, deleteAfter: true } }));
  if (!t) throw notFound('Organization');
  return t;
}

/** Signs everyone out and closes the doors. Reversible until offboarding's deletion date. */
async function disable(id: string, reason: string) {
  await withTenant(id, async (tx) => {
    await tx.tenant.update({ where: { id }, data: { disabledAt: new Date(), disabledReason: reason } });
    await tx.refreshToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
  });
  forgetTenantLookup();
  forgetFeatures(id);
}

lifecycleRouter.get(
  '/tenants/:id/lifecycle',
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const t = await tenantOr404(id);
    const grant = await activeGrant(id);
    const visits = await db().supportSession.findMany({ where: { tenantId: id, usedAt: { not: null } }, orderBy: { usedAt: 'desc' }, take: 10 });
    const admins = await db().platformAdmin.findMany({ where: { id: { in: [...new Set(visits.map((v) => v.adminId))] } }, select: { id: true, name: true } });
    res.json({
      disabledAt: t.disabledAt,
      disabledReason: t.disabledReason,
      offboardedAt: t.offboardedAt,
      deleteAfter: t.deleteAfter?.toISOString().slice(0, 10) ?? null,
      support: grant ? { level: grant.level, expiresAt: grant.expiresAt, reason: grant.reason } : null,
      visits: visits.map((v) => ({ id: v.id, admin: admins.find((a) => a.id === v.adminId)?.name ?? '', startedAt: v.usedAt, endsAt: v.endsAt })),
    });
  }),
);

lifecycleRouter.post(
  '/tenants/:id/disable',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const t = await tenantOr404(id);
    if (t.disabledAt) throw conflict('ALREADY_DISABLED', 'This organization is already closed.');
    await disable(id, reason);
    await record(p.adminId, id, 'tenant.disable', { reason });
    res.json({ ok: true });
  }),
);

lifecycleRouter.post(
  '/tenants/:id/enable',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const t = await tenantOr404(id);
    if (!t.disabledAt) throw conflict('NOT_DISABLED', 'This organization is open.');
    await withTenant(id, (tx) => tx.tenant.update({ where: { id }, data: { disabledAt: null, disabledReason: null, offboardedAt: null, deleteAfter: null } }));
    forgetTenantLookup();
    forgetFeatures(id);
    await record(p.adminId, id, 'tenant.enable');
    res.json({ ok: true });
  }),
);

/**
 * Contract ended: closed now, data deleted after the retention period (after
 * the organization has had its exports). Type the organization's address to confirm.
 */
lifecycleRouter.post(
  '/tenants/:id/offboard',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ reason: z.string().trim().min(3).max(200), retentionDays: z.number().int().min(30).max(3650).default(90), confirm: z.string() }).parse(req.body);
    const t = await tenantOr404(id);
    if (b.confirm.trim().toLowerCase() !== t.subdomain) throw new HttpError(400, 'CONFIRM_MISMATCH', `Type “${t.subdomain}” to confirm.`);
    if (t.offboardedAt) throw conflict('ALREADY_OFFBOARDED', 'This organization is already being offboarded.');
    if (!t.disabledAt) await disable(id, b.reason);
    const deleteAfter = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + b.retentionDays));
    await withTenant(id, (tx) => tx.tenant.update({ where: { id }, data: { offboardedAt: new Date(), deleteAfter } }));
    await record(p.adminId, id, 'tenant.offboard', { reason: b.reason, deleteAfter: deleteAfter.toISOString().slice(0, 10) });
    res.json({ ok: true, deleteAfter: deleteAfter.toISOString().slice(0, 10) });
  }),
);

/** A read-only visit, only while the organization's HR allows it. Returns the one-time link. */
lifecycleRouter.post(
  '/tenants/:id/support-visit',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const t = await tenantOr404(id);
    if (t.disabledAt) throw conflict('DISABLED', 'This organization is closed.');
    const v = await startSupportVisit(id, p.adminId);
    await record(p.adminId, id, 'support.visit', { level: v.level, endsAt: v.endsAt });
    res.status(201).json({ url: appUrl(t.subdomain, `/support?code=${encodeURIComponent(v.code)}`), endsAt: v.endsAt, level: v.level });
  }),
);
