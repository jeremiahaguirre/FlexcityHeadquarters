/** Required coverage: certificates that must be on duty, and where the schedule falls short. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { coverageGaps } from '../services/coverage/gaps.js';
import { facilitiesOf } from '../services/people/scope.js';
import { h } from './context.js';

export const coverageRouter = Router();
coverageRouter.use('/coverage', requireFeature('coverage'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const canSee = (req: Parameters<ReturnType<typeof requirePermission>>[0], _res: unknown, next: (e?: unknown) => void) =>
  req.auth?.permissions.has('coverage.manage') || req.auth?.permissions.has('schedule.write') ? next() : next(notFound('Page'));

const ruleBody = z.object({
  facilityId: uuid,
  name: z.string().trim().min(2).max(80),
  certificationId: uuid,
  minCount: z.number().int().min(1).max(20),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(2880),
  note: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
});

coverageRouter.get(
  '/coverage/rules',
  canSee,
  h(async (req, res) => {
    const a = authOf(req);
    const only = facilitiesOf(a.scope);
    res.json(await withTenant(a.tenantId, (tx) => tx.coverageRule.findMany({ where: only ? { facilityId: { in: only } } : {}, orderBy: [{ facilityId: 'asc' }, { name: 'asc' }] })));
  }),
);

coverageRouter.post(
  '/coverage/rules',
  requirePermission('coverage.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = ruleBody.parse(req.body);
    if (b.endMinute <= b.startMinute) throw badRequest('The window must end after it starts.');
    const r = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.certification.findFirst({ where: { id: b.certificationId } }))) throw notFound('Certification');
      const created = await tx.coverageRule.create({ data: { ...b, note: b.note ?? null, tenantId: a.tenantId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'coverage.create', entity: 'CoverageRule', entityId: created.id, after: b });
      return created;
    });
    res.status(201).json(r);
  }),
);

coverageRouter.patch(
  '/coverage/rules/:id',
  requirePermission('coverage.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = ruleBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.coverageRule.findUnique({ where: { id } }))) throw notFound('Rule');
      await tx.coverageRule.update({ where: { id }, data: b });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'coverage.update', entity: 'CoverageRule', entityId: id, after: b });
    });
    res.json({ ok: true });
  }),
);

coverageRouter.delete(
  '/coverage/rules/:id',
  requirePermission('coverage.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const gone = await tx.coverageRule.deleteMany({ where: { id } });
      if (!gone.count) throw notFound('Rule');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'coverage.delete', entity: 'CoverageRule', entityId: id });
    });
    res.status(204).end();
  }),
);

/** Where the published schedule falls short, day by day. */
coverageRouter.get(
  '/coverage/gaps',
  canSee,
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(31).default(7), facilityId: uuid.optional() }).parse(req.query);
    const only = facilitiesOf(a.scope);
    const gaps = await withTenant(a.tenantId, (tx) => coverageGaps(tx, q.from, q.days, q.facilityId));
    // A lead limited to some facilities sees only their gaps.
    res.json(only ? gaps.filter((g) => only.includes(g.facilityId)) : gaps);
  }),
);
