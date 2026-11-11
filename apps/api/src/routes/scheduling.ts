import type { Prisma } from '@prisma/client';
import { assertShiftInScope, assertUserInScope, peopleWhere, shiftsWhere } from '../services/people/scope.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Tx } from '../lib/db.js';
import { authOf, requirePermission } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { dispatchSoon, withEvents } from '../lib/events.js';
import { assignShift, cancelShift, createShift, publishCheck, publishShifts, rankCandidates, updateShift } from '../services/scheduling/shifts.js';
import { audit } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { previewShiftPay } from '../services/payroll/payPreview.js';
import { notFound } from '../lib/errors.js';
import { teamOf, teamQuery } from '../services/people/reporting.js';
import { h } from './context.js';
import { shiftInclude, shiftView } from './serializers.js';

async function shiftScoped(tx: Parameters<Parameters<typeof withTenant>[1]>[0], a: ReturnType<typeof authOf>, id: string) {
  const s = await tx.shift.findUnique({ where: { id }, select: { positionId: true, facilityId: true } });
  if (s) assertShiftInScope(a, s);
}

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
          select: { id: true, name: true, nameFr: true, minimumAge: true, hoursOfService: true, requirements: { select: { certificationId: true } } },
          orderBy: { name: 'asc' },
        }),
      ),
    );
  }),
);

/**
 * The positions in a person's department(s): every position in each department one of their
 * positions belongs to. A position outside any department stands alone.
 */
async function departmentPositions(tx: Tx, userId: string): Promise<string[]> {
  const mine = await tx.userPosition.findMany({ where: { userId }, select: { position: { select: { id: true, departmentId: true } } } });
  const departments = [...new Set(mine.map((m) => m.position.departmentId).filter((d): d is string => !!d))];
  const inDepartments = departments.length ? await tx.position.findMany({ where: { departmentId: { in: departments } }, select: { id: true } }) : [];
  return [...new Set([...mine.map((m) => m.position.id), ...inDepartments.map((p) => p.id)])];
}

const range = z.object({ from: z.coerce.date(), to: z.coerce.date(), facilityId: uuid.optional() });

schedulingRouter.get(
  '/shifts',
  requirePermission('schedule.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = range.parse(req.query);
    if (q.to <= q.from || q.to.getTime() - q.from.getTime() > 62 * 86_400_000) throw badRequest('Choose a range of up to 62 days.');
    const manager = a.permissions.has('schedule.write');
    const shifts = await withTenant(a.tenantId, async (tx) => {
      const where: Prisma.ShiftWhereInput = {
        startsAt: { gte: q.from, lt: q.to },
        ...(q.facilityId ? { facilityId: q.facilityId } : {}),
        ...(manager ? { status: { not: 'CANCELLED' } } : { status: 'PUBLISHED' }),
        // A department supervisor builds their own department's schedule; everyone else sees their department's.
        ...(manager ? shiftsWhere(a.scope) : a.roles.includes('UNION_STEWARD') ? {} : { OR: [{ userId: a.userId }, { positionId: { in: await departmentPositions(tx, a.userId) } }] }),
      };
      return tx.shift.findMany({ where, include: shiftInclude, orderBy: { startsAt: 'asc' } });
    });
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
    assertShiftInScope(a, body);
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
      await shiftScoped(tx, a, uuid.parse(req.params.id));
      if (patch.positionId) assertShiftInScope(a, { positionId: patch.positionId, facilityId: (await tx.shift.findUniqueOrThrow({ where: { id: uuid.parse(req.params.id) } })).facilityId });
      const r = await withEvents(tx, updateShift(tx, actor(req), uuid.parse(req.params.id), expectedVersion, patch));
      return { shift: await tx.shift.findUniqueOrThrow({ where: { id: r.shift.id }, include: shiftInclude }), events: r.events };
    });
    dispatchSoon(a.tenantId);
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
      await shiftScoped(tx, a, uuid.parse(req.params.id));
      if (body.userId) await assertUserInScope(tx, a, body.userId);
      const r = await withEvents(tx, assignShift(tx, actor(req), uuid.parse(req.params.id), body.userId, body.expectedVersion, body.acknowledgeOvertime));
      return { shift: await tx.shift.findUniqueOrThrow({ where: { id: r.shift.id }, include: shiftInclude }), events: r.events, evaluation: r.evaluation };
    });
    dispatchSoon(a.tenantId);
    res.json({ shift: shiftView(out.shift, { fullNames: true }), flags: out.evaluation?.flags ?? [] });
  }),
);

schedulingRouter.post(
  '/shifts/:id/cancel',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      await shiftScoped(tx, a, uuid.parse(req.params.id));
      return withEvents(tx, cancelShift(tx, actor(req), uuid.parse(req.params.id), reason));
    });
    dispatchSoon(a.tenantId);
    res.json({ ok: true });
  }),
);

schedulingRouter.post(
  '/shifts/publish',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    // `shiftIds`: publish only these drafts (e.g. one open shift to post to the board).
    // `acknowledgeWarnings`: publish anyway despite coverage gaps / people who can't work a shift (audited).
    const body = z.object({ facilityId: uuid, from: z.coerce.date(), to: z.coerce.date(), shiftIds: z.array(uuid).min(1).max(3000).optional(), acknowledgeWarnings: z.boolean().default(false) }).parse(req.body);
    if (a.scope?.facilityIds.length && !a.scope.facilityIds.includes(body.facilityId)) throw forbidden('This facility isn’t in your department.');
    const only = { ...shiftsWhere(a.scope), ...(body.shiftIds ? { id: { in: body.shiftIds } } : {}) };
    const out = await withTenant(a.tenantId, async (tx) => {
      const check = await publishCheck(tx, body.facilityId, body.from, body.to, only);
      const warned = check.gaps.length > 0 || check.ineligible.length > 0 || !!check.federalNotice;
      if (warned && !body.acknowledgeWarnings) throw new HttpError(409, 'PUBLISH_WARNINGS', 'Publishing leaves coverage gaps or shifts someone can’t work. Review and confirm to publish anyway.', check);
      if (warned) await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'shift.publish.warnings_acknowledged', entity: 'Facility', entityId: body.facilityId, after: { gaps: check.gaps.length, ineligible: check.ineligible.length, federalNotice: check.federalNotice, from: body.from, to: body.to } });
      return withEvents(tx, publishShifts(tx, actor(req), body.facilityId, body.from, body.to, only));
    });
    dispatchSoon(a.tenantId);
    res.json({ published: out.published, postedToBoard: out.posted });
  }),
);

/** What publishing would leave: required-coverage gaps, shifts someone can no longer work, federal notice. */
schedulingRouter.post(
  '/shifts/publish/check',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ facilityId: uuid, from: z.coerce.date(), to: z.coerce.date(), shiftIds: z.array(uuid).min(1).max(3000).optional() }).parse(req.body);
    if (a.scope?.facilityIds.length && !a.scope.facilityIds.includes(body.facilityId)) throw forbidden('This facility isn’t in your department.');
    const only = { ...shiftsWhere(a.scope), ...(body.shiftIds ? { id: { in: body.shiftIds } } : {}) };
    res.json(await withTenant(a.tenantId, (tx) => publishCheck(tx, body.facilityId, body.from, body.to, only)));
  }),
);

schedulingRouter.get(
  '/shifts/:id/candidates',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write') && !a.permissions.has('shiftboard.assign_emergency')) throw forbidden();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        await shiftScoped(tx, a, uuid.parse(req.params.id));
        // Only people the caller may schedule (a facility-only lead sees their own people).
        return rankCandidates(tx, uuid.parse(req.params.id), peopleWhere(a.scope));
      }),
    );
  }),
);

schedulingRouter.get(
  '/offers/pending',
  requirePermission('shiftboard.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const { team } = z.object({ team: teamQuery }).parse(req.query);
    const offers = await withTenant(a.tenantId, async (tx) =>
      tx.shiftOffer.findMany({
        where: { status: 'PENDING_APPROVAL', shift: shiftsWhere(a.scope), ...(team ? { claimedById: { in: await teamOf(tx, a.userId) } } : {}) },
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
