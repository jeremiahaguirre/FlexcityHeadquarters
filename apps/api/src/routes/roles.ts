/** An organization's own roles for non-aquatic jobs (water works, maintenance…). */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { CUSTOM_ROLE_PERMISSIONS, customRoleBody, deleteCustomRole, listCustomRoles, saveCustomRole } from '../services/people/customRoles.js';
import { h } from './context.js';

export const rolesRouter = Router();
const uuid = z.string().uuid();

rolesRouter.get(
  '/roles',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json({ roles: await withTenant(a.tenantId, listCustomRoles), catalog: CUSTOM_ROLE_PERMISSIONS });
  }),
);

rolesRouter.post(
  '/roles',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = customRoleBody.parse(req.body);
    const role = await withTenant(a.tenantId, async (tx) => {
      const r = await saveCustomRole(tx, a.tenantId, null, body);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'role.create', entity: 'CustomRole', entityId: r.id, after: body });
      return r;
    });
    res.status(201).json({ id: role.id });
  }),
);

rolesRouter.put(
  '/roles/:id',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = customRoleBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await saveCustomRole(tx, a.tenantId, id, body);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'role.update', entity: 'CustomRole', entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

rolesRouter.delete(
  '/roles/:id',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      await deleteCustomRole(tx, a.tenantId, id);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'role.delete', entity: 'CustomRole', entityId: id });
    });
    res.status(204).end();
  }),
);
