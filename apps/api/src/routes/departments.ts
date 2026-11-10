import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { departmentBody, deleteDepartment, listDepartments, saveDepartment } from '../services/people/departmentAdmin.js';
import { h } from './context.js';

export const departmentsRouter = Router();
const uuid = z.string().uuid();

/**
 * Departments and their positions. HR sees every department (for its tabs);
 * a supervisor or manager limited to some departments sees only theirs.
 */
departmentsRouter.get(
  '/departments',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, listDepartments);
    const mine = a.scope?.positionIds.length ? a.scope.positionIds : null;
    if (!mine) return void res.json({ ...out, limited: false });
    res.json({
      departments: out.departments.map((d) => ({ ...d, positions: d.positions.filter((p) => mine.includes(p.id)) })).filter((d) => d.positions.length),
      unassigned: out.unassigned.filter((p) => mine.includes(p.id)),
      limited: true,
    });
  }),
);

departmentsRouter.post(
  '/departments',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = departmentBody.parse(req.body);
    const d = await withTenant(a.tenantId, async (tx) => {
      const created = await saveDepartment(tx, a.tenantId, null, body);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'department.create', entity: 'Department', entityId: created.id, after: body });
      return created;
    });
    res.status(201).json({ id: d.id });
  }),
);

departmentsRouter.put(
  '/departments/:id',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = departmentBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await saveDepartment(tx, a.tenantId, id, body);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'department.update', entity: 'Department', entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

departmentsRouter.delete(
  '/departments/:id',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      await deleteDepartment(tx, a.tenantId, id);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'department.delete', entity: 'Department', entityId: id });
    });
    res.status(204).end();
  }),
);
