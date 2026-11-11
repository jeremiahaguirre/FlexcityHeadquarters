/**
 * Special events for the demand forecast (Manage › Forecast): list, add, change, remove.
 * One facility or every facility in the city. A lead limited to some facilities sees their own
 * and the city-wide ones, and changes only their own.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { facilitiesOf } from '../services/people/scope.js';
import { h } from './context.js';

export const forecastEventsRouter = Router();
forecastEventsRouter.use('/forecast/events', requirePermission('schedule.write'));

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const body = z
  .object({
    facilityId: uuid.nullable(),
    name: z.string().trim().min(2).max(120),
    startsOn: isoDate,
    endsOn: isoDate,
    startMinute: z.number().int().min(0).max(1439).nullable().default(null),
    endMinute: z.number().int().min(1).max(1440).nullable().default(null),
    extraPeople: z.number().int().min(1).max(100_000).nullable().default(null),
    percent: z.number().int().min(-90).max(300).nullable().default(null),
    recursYearly: z.boolean().default(false),
    notes: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

function check(b: Partial<z.infer<typeof body>> & { startsOn: string; endsOn: string }) {
  if (b.endsOn < b.startsOn) throw badRequest('The event ends before it starts.');
  if (Date.parse(b.endsOn) - Date.parse(b.startsOn) > 31 * 86_400_000) throw badRequest('An event lasts a month at most.');
  if ((b.startMinute === null) !== (b.endMinute === null)) throw badRequest('Give both times, or neither for all day.');
  if (b.startMinute !== null && b.endMinute !== null && b.endMinute! <= b.startMinute!) throw badRequest('The event ends before it starts.');
  if (!b.extraPeople && !b.percent) throw badRequest('Give the extra people expected or a percentage.');
}

const out = (e: { id: string; facilityId: string | null; name: string; startsOn: Date; endsOn: Date; startMinute: number | null; endMinute: number | null; extraPeople: number | null; percent: number | null; recursYearly: boolean; notes: string | null }) => ({
  id: e.id,
  facilityId: e.facilityId,
  name: e.name,
  startsOn: iso(e.startsOn),
  endsOn: iso(e.endsOn),
  startMinute: e.startMinute,
  endMinute: e.endMinute,
  extraPeople: e.extraPeople,
  percent: e.percent,
  recursYearly: e.recursYearly,
  notes: e.notes,
});

/** Whether this person may change an event for `facilityId` (null = the whole city). */
function mayChange(req: Parameters<typeof authOf>[0], facilityId: string | null) {
  const only = facilitiesOf(authOf(req).scope);
  if (!only) return;
  if (facilityId === null) throw forbidden('Only someone for the whole city can add a city-wide event.');
  if (!only.includes(facilityId)) throw notFound('Facility');
}

forecastEventsRouter.get(
  '/forecast/events',
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ facilityId: uuid.optional() }).parse(req.query);
    const only = facilitiesOf(a.scope);
    if (q.facilityId && only && !only.includes(q.facilityId)) throw notFound('Facility');
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.specialEvent.findMany({
        where: q.facilityId ? { OR: [{ facilityId: q.facilityId }, { facilityId: null }] } : only ? { OR: [{ facilityId: { in: only } }, { facilityId: null }] } : {},
        orderBy: [{ startsOn: 'asc' }, { name: 'asc' }],
      }),
    );
    res.json(rows.map(out));
  }),
);

forecastEventsRouter.post(
  '/forecast/events',
  h(async (req, res) => {
    const a = authOf(req);
    const b = body.parse(req.body);
    check(b);
    mayChange(req, b.facilityId);
    const row = await withTenant(a.tenantId, async (tx) => {
      if (b.facilityId && !(await tx.facility.findUnique({ where: { id: b.facilityId } }))) throw notFound('Facility');
      const e = await tx.specialEvent.create({ data: { ...b, tenantId: a.tenantId, startsOn: new Date(`${b.startsOn}T00:00:00Z`), endsOn: new Date(`${b.endsOn}T00:00:00Z`), createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'forecast.event_add', entity: 'SpecialEvent', entityId: e.id, after: b });
      return e;
    });
    res.status(201).json(out(row));
  }),
);

forecastEventsRouter.patch(
  '/forecast/events/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const patch = body.partial().parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      const before = await tx.specialEvent.findUnique({ where: { id } });
      if (!before) throw notFound('Event');
      mayChange(req, before.facilityId);
      if (patch.facilityId !== undefined) mayChange(req, patch.facilityId);
      if (patch.facilityId && !(await tx.facility.findUnique({ where: { id: patch.facilityId } }))) throw notFound('Facility');
      const merged = { ...out(before), ...patch };
      check(merged);
      const e = await tx.specialEvent.update({
        where: { id },
        data: { ...patch, ...(patch.startsOn ? { startsOn: new Date(`${patch.startsOn}T00:00:00Z`) } : {}), ...(patch.endsOn ? { endsOn: new Date(`${patch.endsOn}T00:00:00Z`) } : {}) },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'forecast.event_update', entity: 'SpecialEvent', entityId: id, before: out(before), after: patch });
      return e;
    });
    res.json(out(row));
  }),
);

forecastEventsRouter.delete(
  '/forecast/events/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.specialEvent.findUnique({ where: { id } });
      if (!before) throw notFound('Event');
      mayChange(req, before.facilityId);
      await tx.specialEvent.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'forecast.event_remove', entity: 'SpecialEvent', entityId: id, before: out(before) });
    });
    res.status(204).end();
  }),
);
