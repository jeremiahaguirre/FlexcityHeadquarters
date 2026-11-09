/** An organization's own roles for non-aquatic jobs (water works, maintenance…). */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { CUSTOM_ROLE_PERMISSIONS, covers, customRoleBody, deleteCustomRole, listCustomRoles, saveCustomRole, setUserCustomRoles } from '../services/people/customRoles.js';
import { actorOf, assertUserInScope } from '../services/people/scope.js';
import { h } from './context.js';

export const rolesRouter = Router();
const uuid = z.string().uuid();

rolesRouter.get(
  '/roles',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const roles = await withTenant(a.tenantId, listCustomRoles);
    const actor = a.permissions.has('roles.manage') ? actorOf(a) : null;
    res.json({
      // Each role says whether this person may change it or give it to someone.
      roles: roles.map((r) => ({ ...r, canManage: !!actor && covers(actor, { permissions: r.permissions, scopePositionIds: r.scopePositionIds, scopeFacilityIds: r.scopeFacilityIds }) })),
      catalog: CUSTOM_ROLE_PERMISSIONS,
      // What this person may put in a role: only capabilities they hold, inside their department.
      // null = anything (the organization's own administrators).
      grantable: !actor ? [] : !a.scope && a.permissions.has('tenant.configure') ? null : [...a.permissions],
      scope: a.scope,
    });
  }),
);

rolesRouter.post(
  '/roles',
  requirePermission('roles.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = customRoleBody.parse(req.body);
    const role = await withTenant(a.tenantId, async (tx) => {
      const r = await saveCustomRole(tx, a.tenantId, null, body, actorOf(a));
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'role.create', entity: 'CustomRole', entityId: r.id, after: body });
      return r;
    });
    res.status(201).json({ id: role.id });
  }),
);

rolesRouter.put(
  '/roles/:id',
  requirePermission('roles.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = customRoleBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await saveCustomRole(tx, a.tenantId, id, body, actorOf(a));
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'role.update', entity: 'CustomRole', entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

rolesRouter.delete(
  '/roles/:id',
  requirePermission('roles.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      await deleteCustomRole(tx, a.tenantId, id, actorOf(a));
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'role.delete', entity: 'CustomRole', entityId: id });
    });
    res.status(204).end();
  }),
);

/** A manager gives their crew roles (only roles they could grant themselves). */
rolesRouter.put(
  '/users/:id/roles',
  requirePermission('roles.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { customRoleIds } = z.object({ customRoleIds: z.array(uuid).max(10) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await assertUserInScope(tx, a, id);
      await setUserCustomRoles(tx, a.tenantId, id, customRoleIds, actorOf(a));
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'user.roles', entity: 'User', entityId: id, after: { customRoleIds } });
    });
    res.json({ ok: true });
  }),
);
