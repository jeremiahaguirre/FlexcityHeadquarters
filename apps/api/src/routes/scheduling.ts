import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { assignShift, cancelShift, createShift, publishShifts, rankCandidates, updateShift } from '../services/scheduling/shifts.js';
import { previewShiftPay } from '../services/payroll/payPreview.js';
import { notFound } from '../lib/errors.js';
import { h } from './context.js';
import { shiftInclude, shiftView } from './serializers.js';

export const schedulingRouter = Router();
const uuid = z.string().uuid();
const money = z.string().regex(/^\d{1,4}(\.\d{1,2})?$/);
const actor = (req: Parameters<typeof authOf>[0]) => ({ userId: authOf(req).userId, tenantId: authOf(req).tenantId });

schedulingRouter.get(
  '/facilities',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, (tx) =>
        tx.facility.findMany({ select: { id: true, name: true, timezone: true, province: true }, orderBy: { name: 'asc' } }),
      ),
    );
  }),
);

schedulingRouter.get(
  '/positions',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, (tx) =>
        tx.position.findMany({
          select: { id: true, name: true, nameFr: true, minimumAge: true, requirements: { select: { certificationId: true } } },
          orderBy: { name: 'asc' },
        }),
      ),
    );
  }),
);

const range = z.object({ from: z.coerce.date(), to: z.coerce.date(), facilityId: uuid.optional() });

schedulingRouter.get(
  '/shifts',
  requirePermission('schedule.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = range.parse(req.query);
    if (q.to <= q.from || q.to.getTime() - q.from.getTime() > 62 * 86_400_000) throw badRequest('Choose a range of up to 62 days.');
    const manager = a.permissions.has('schedule.write');
    const where: Prisma.ShiftWhereInput = {
      startsAt: { gte: q.from, lt: q.to },
      ...(q.facilityId ? { facilityId: q.facilityId } : {}),
      ...(manager ? { status: { not: 'CANCELLED' } } : { status: 'PUBLISHED' }),
    };
    const shifts = await withTenant(a.tenantId, (tx) => tx.shift.findMany({ where, include: shiftInclude, orderBy: { startsAt: 'asc' } }));
    res.json(shifts.map((s) => shiftView(s, { fullNames: manager })));
  }),
);

schedulingRouter.get(
  '/me/shifts',
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    const shifts = await withTenant(a.tenantId, (tx) =>
      tx.shift.findMany({
        where: { userId: a.userId, status: 'PUBLISHED', startsAt: { gte: q.from, lt: q.to } },
        include: { ...shiftInclude, offers: { where: { status: { in: ['OPEN', 'PENDING_APPROVAL'] } }, select: { id: true, status: true } } },
        orderBy: { startsAt: 'asc' },
      }),
    );
    res.json(shifts.map((s) => ({ ...shiftView(s, { fullNames: true }), offer: s.offers[0] ?? null })));
  }),
);

const shiftBody = z.object({
  facilityId: uuid,
  positionId: uuid,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  shiftType: z.enum(['STANDARD', 'CUSTOM', 'MANDATORY']).optional(),
  customTitle: z.string().max(120).nullable().optional(),
  premiumPerHour: money.nullable().optional(),
});

schedulingRouter.post(
  '/shifts',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = shiftBody.parse(req.body);
    const s = await withTenant(a.tenantId, async (tx) => {
      const created = await createShift(tx, actor(req), body);
      return tx.shift.findUniqueOrThrow({ where: { id: created.id }, include: shiftInclude });
    });
    res.status(201).json(shiftView(s, { fullNames: true }));
  }),
);

schedulingRouter.patch(
  '/shifts/:id',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = shiftBody.omit({ facilityId: true }).partial().extend({ expectedVersion: z.number().int() }).parse(req.body);
    const { expectedVersion, ...patch } = body;
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await updateShift(tx, actor(req), uuid.parse(req.params.id), expectedVersion, patch);
      return { shift: await tx.shift.findUniqueOrThrow({ where: { id: r.shift.id }, include: shiftInclude }), events: r.events };
    });
    publish(out.events);
    res.json(shiftView(out.shift, { fullNames: true }));
  }),
);

schedulingRouter.post(
  '/shifts/:id/assign',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write') && !a.permissions.has('shiftboard.assign_emergency')) throw forbidden();
    const body = z.object({ userId: uuid.nullable(), expectedVersion: z.number().int(), acknowledgeOvertime: z.boolean().default(false) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await assignShift(tx, actor(req), uuid.parse(req.params.id), body.userId, body.expectedVersion, body.acknowledgeOvertime);
      return { shift: await tx.shift.findUniqueOrThrow({ where: { id: r.shift.id }, include: shiftInclude }), events: r.events, evaluation: r.evaluation };
    });
    publish(out.events);
    res.json({ shift: shiftView(out.shift, { fullNames: true }), flags: out.evaluation?.flags ?? [] });
  }),
);

schedulingRouter.post(
  '/shifts/:id/cancel',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => cancelShift(tx, actor(req), uuid.parse(req.params.id), reason));
    publish(out.events);
    res.json({ ok: true });
  }),
);

schedulingRouter.post(
  '/shifts/publish',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ facilityId: uuid, from: z.coerce.date(), to: z.coerce.date() }).parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => publishShifts(tx, actor(req), body.facilityId, body.from, body.to));
    publish(out.events);
    res.json({ published: out.published, postedToBoard: out.posted });
  }),
);

schedulingRouter.get(
  '/shifts/:id/candidates',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write') && !a.permissions.has('shiftboard.assign_emergency')) throw forbidden();
    res.json(await withTenant(a.tenantId, (tx) => rankCandidates(tx, uuid.parse(req.params.id))));
  }),
);

schedulingRouter.get(
  '/offers/pending',
  requirePermission('shiftboard.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const offers = await withTenant(a.tenantId, (tx) =>
      tx.shiftOffer.findMany({
        where: { status: 'PENDING_APPROVAL' },
        include: {
          shift: { include: shiftInclude },
          claimedBy: { select: { id: true, firstName: true, lastName: true } },
          postedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { updatedAt: 'asc' },
      }),
    );
    res.json(
      offers.map((o) => ({
        id: o.id,
        source: o.source,
        requestedAt: o.updatedAt,
        complianceSnapshot: o.complianceSnapshot,
        claimant: o.claimedBy && { id: o.claimedBy.id, name: `${o.claimedBy.firstName} ${o.claimedBy.lastName}` },
        postedBy: o.postedBy && { id: o.postedBy.id, name: `${o.postedBy.firstName} ${o.postedBy.lastName}` },
        shift: shiftView(o.shift, { fullNames: true }),
      })),
    );
  }),
);


/** What an open shift would add to my pay (estimate, same engine as payroll). */
schedulingRouter.get(
  '/offers/:id/pay-preview',
  requirePermission('shiftboard.claim'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const offer = await tx.shiftOffer.findUnique({ where: { id }, select: { shiftId: true } });
      if (!offer) throw notFound('Offer');
      return previewShiftPay(tx, a.userId, offer.shiftId);
    });
    if (!out) throw notFound('Shift');
    res.json(out);
  }),
);
