/** Overtime equalization: standings, call-out records, the pre-assignment check and the city's policy. */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { fairnessCheck, parsePolicy, standings } from '../services/scheduling/overtime.js';
import { h } from './context.js';

export const overtimeRouter = Router();
overtimeRouter.use('/overtime', requireFeature('overtime'));
const uuid = z.string().uuid();

/** Who is next in line for overtime in a position. Union stewards can read it too. */
overtimeRouter.get(
  '/overtime/standings',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('overtime.manage') && !a.permissions.has('seniority.read')) throw forbidden();
    const positionId = uuid.parse(req.query.positionId);
    res.json(await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.position.findUnique({ where: { id: positionId } }))) throw notFound('Position');
      return standings(tx, positionId);
    }));
  }),
);

/** Record a call-out: accepted, refused or no answer. */
overtimeRouter.post(
  '/overtime/entries',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ userId: uuid, positionId: uuid, kind: z.enum(['ACCEPTED', 'REFUSED', 'NO_ANSWER']), hours: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/), occurredAt: z.string().datetime({ offset: true }), note: z.string().trim().max(300).nullable().default(null) }).parse(req.body);
    const id = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.userPosition.findFirst({ where: { userId: body.userId, positionId: body.positionId } }))) throw notFound('Person in this position');
      const e = await tx.overtimeEntry.create({ data: { tenantId: a.tenantId, userId: body.userId, positionId: body.positionId, kind: body.kind, hours: body.hours, occurredAt: new Date(body.occurredAt), recordedById: a.userId, note: body.note } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'overtime.entry', entity: 'OvertimeEntry', entityId: e.id, after: body });
      return e.id;
    });
    res.status(201).json({ id });
  }),
);

/** Before approving or assigning overtime: who would be skipped? */
overtimeRouter.get(
  '/overtime/check',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('overtime.manage') && !a.permissions.has('shiftboard.approve')) throw forbidden();
    const q = z.object({ shiftId: uuid, userId: uuid }).parse(req.query);
    const out = await withTenant(a.tenantId, (tx) => fairnessCheck(tx, q.shiftId, q.userId));
    if (!out) throw notFound('Shift');
    res.json(out);
  }),
);

overtimeRouter.get(
  '/overtime/policy',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { overtimePolicy: true } }));
    res.json(parsePolicy(t.overtimePolicy));
  }),
);

overtimeRouter.put(
  '/overtime/policy',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ countRefusals: z.boolean(), clause: z.string().trim().max(200).nullable(), periodStartMonth: z.number().int().min(1).max(12) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: a.tenantId }, data: { overtimePolicy: body as Prisma.InputJsonValue } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'overtime.policy', entity: 'Tenant', entityId: a.tenantId, after: body });
    });
    res.json(body);
  }),
);
