/** Accommodation and return-to-work restrictions: HR only; the employee sees their own. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { h } from './context.js';
import { hrRecordsBy } from '../services/people/scope.js';

export const accommodationRouter = Router();
accommodationRouter.use(['/accommodations', '/me/accommodations', '/users/:id/accommodations'], requireFeature('accommodation'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

const view = (c: { id: string; status: string; label: string; startsOn: Date; endsOn: Date | null; reviewOn: Date | null; maxShiftHours: unknown; maxWeeklyHours: unknown; noStartBefore: number | null; noEndAfter: number | null; daysOff: number[]; excludedPositionIds: string[] }) => ({
  id: c.id,
  status: c.status,
  label: c.label,
  startsOn: c.startsOn.toISOString().slice(0, 10),
  endsOn: c.endsOn?.toISOString().slice(0, 10) ?? null,
  reviewOn: c.reviewOn?.toISOString().slice(0, 10) ?? null,
  maxShiftHours: c.maxShiftHours === null ? null : Number(c.maxShiftHours),
  maxWeeklyHours: c.maxWeeklyHours === null ? null : Number(c.maxWeeklyHours),
  noStartBefore: c.noStartBefore,
  noEndAfter: c.noEndAfter,
  daysOff: c.daysOff,
  excludedPositionIds: c.excludedPositionIds,
});

const body = z.object({
  label: z.string().trim().min(2).max(80),
  startsOn: isoDate,
  endsOn: isoDate.nullable().default(null),
  reviewOn: isoDate.nullable().default(null),
  maxShiftHours: z.number().min(1).max(16).nullable().default(null),
  maxWeeklyHours: z.number().min(1).max(80).nullable().default(null),
  noStartBefore: z.number().int().min(0).max(1439).nullable().default(null),
  noEndAfter: z.number().int().min(1).max(1440).nullable().default(null),
  daysOff: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  excludedPositionIds: z.array(uuid).max(50).default([]),
});

accommodationRouter.get(
  '/users/:id/accommodations',
  requirePermission('accommodation.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const rows = await withTenant(a.tenantId, async (tx) => {
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'accommodation.view', entity: 'User', entityId: userId });
      // HR sees every case; anyone else only the cases they opened.
      const by = hrRecordsBy(a);
      return tx.accommodationCase.findMany({ where: { userId, ...(by ? { createdById: by } : {}) }, orderBy: [{ status: 'asc' }, { startsOn: 'desc' }] });
    });
    res.json(rows.map(view));
  }),
);

accommodationRouter.post(
  '/users/:id/accommodations',
  requirePermission('accommodation.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const b = body.parse(req.body);
    if (b.endsOn && b.endsOn < b.startsOn) throw badRequest('The end date is before the start date.');
    const c = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: userId } }))) throw notFound('Staff member');
      const created = await tx.accommodationCase.create({ data: { tenantId: a.tenantId, userId, label: b.label, startsOn: day(b.startsOn)!, endsOn: day(b.endsOn), reviewOn: day(b.reviewOn), maxShiftHours: b.maxShiftHours, maxWeeklyHours: b.maxWeeklyHours, noStartBefore: b.noStartBefore, noEndAfter: b.noEndAfter, daysOff: b.daysOff, excludedPositionIds: b.excludedPositionIds, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'accommodation.create', entity: 'AccommodationCase', entityId: created.id });
      await notify(tx, a.tenantId, [{ userId, type: 'accommodation_set', link: '/profile' }]);
      return created;
    });
    res.status(201).json(view(c));
  }),
);

accommodationRouter.patch(
  '/accommodations/:id',
  requirePermission('accommodation.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = body.partial().extend({ close: z.boolean().optional() }).parse(req.body);
    const c = await withTenant(a.tenantId, async (tx) => {
      const by = hrRecordsBy(a);
      if (!(await tx.accommodationCase.findFirst({ where: { id, ...(by ? { createdById: by } : {}) } }))) throw notFound('Accommodation');
      const { close, startsOn, endsOn, reviewOn, ...rest } = b;
      const updated = await tx.accommodationCase.update({
        where: { id },
        data: {
          ...rest,
          ...(startsOn ? { startsOn: day(startsOn)! } : {}),
          ...(endsOn !== undefined ? { endsOn: day(endsOn) } : {}),
          ...(reviewOn !== undefined ? { reviewOn: day(reviewOn), reviewNotifiedAt: null } : {}),
          ...(close ? { status: 'CLOSED' as const, closedAt: new Date() } : {}),
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: close ? 'accommodation.close' : 'accommodation.update', entity: 'AccommodationCase', entityId: id });
      return updated;
    });
    res.json(view(c));
  }),
);

/** The employee sees their own active restrictions. */
accommodationRouter.get(
  '/me/accommodations',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.accommodationCase.findMany({ where: { userId: a.userId, status: 'ACTIVE' }, orderBy: { startsOn: 'desc' } }));
    res.json(rows.map(view));
  }),
);
