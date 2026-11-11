import { Router } from 'express';
import { assertUserInScope, peopleWhere } from '../services/people/scope.js';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { dispatchSoon, recordEvents, withEvents } from '../lib/events.js';
import { localIso } from '../lib/time.js';
import { cancelTimeOff, decideTimeOff, replaceAvailability, requestTimeOff } from '../services/people/timeOff.js';
import { decidePunches, punchVariance } from '../services/timeclock/review.js';
import { teamOf, teamQuery } from '../services/people/reporting.js';
import { confirmAvailability } from '../services/scheduling/fillRun.js';
import { h } from './context.js';

export const attendanceRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const window = z.object({ dayOfWeek: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) });

// ------------------------------------------------------------ Availability
attendanceRouter.get(
  '/me/availability',
  h(async (req, res) => {
    const a = authOf(req);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.availability.findMany({
        where: { userId: a.userId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
        orderBy: [{ effectiveFrom: 'asc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      }),
    );
    res.json(rows.map((r) => ({ ...r, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null })));
  }),
);

attendanceRouter.put(
  '/me/availability',
  requirePermission('availability.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ effectiveFrom: isoDate, windows: z.array(window).max(42) }).parse(req.body);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const out = await replaceAvailability(tx, a.tenantId, a.userId, body.effectiveFrom, body.windows);
      // Updating availability counts as keeping it current through the planning window.
      await confirmAvailability(tx, a.tenantId, a.userId, 'availability.update');
      return out;
    });
    res.json(rows);
  }),
);

attendanceRouter.get(
  '/users/:id/availability',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const today = new Date(new Date().toISOString().slice(0, 10));
    res.json(
      await withTenant(a.tenantId, async (tx) =>
        (await assertUserInScope(tx, a, uuid.parse(req.params.id)), tx).availability.findMany({
          where: { userId: uuid.parse(req.params.id), OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
          orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
        }),
      ),
    );
  }),
);

// ---------------------------------------------------------------- Time off
const timeOffType = z.enum(['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER', 'LIEU']);

attendanceRouter.get(
  '/me/time-off',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => tx.timeOffRequest.findMany({ where: { userId: a.userId }, orderBy: { startsAt: 'desc' }, take: 100 })));
  }),
);

attendanceRouter.post(
  '/me/time-off',
  requirePermission('timeoff.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ type: timeOffType, startsAt: z.coerce.date(), endsAt: z.coerce.date(), note: z.string().max(500).nullable().optional() }).parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => withEvents(tx, requestTimeOff(tx, a.tenantId, a.userId, body)));
    dispatchSoon(a.tenantId);
    res.status(201).json({ request: out.request, affectedShifts: out.affectedShifts });
  }),
);

attendanceRouter.post(
  '/me/time-off/:id/cancel',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => cancelTimeOff(tx, a.userId, uuid.parse(req.params.id))));
  }),
);

attendanceRouter.get(
  '/time-off',
  requirePermission('timeoff.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ status: z.enum(['PENDING', 'APPROVED', 'DENIED', 'CANCELLED']).default('PENDING'), team: teamQuery }).parse(req.query);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const team = q.team ? await teamOf(tx, a.userId) : null;
      const list = await tx.timeOffRequest.findMany({
        where: { status: q.status, user: peopleWhere(a.scope), ...(team ? { userId: { in: team } } : {}) },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { startsAt: 'asc' },
        take: 200,
      });
      return Promise.all(
        list.map(async (r) => ({
          ...r,
          user: { id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}` },
          affectedShifts: await tx.shift.count({ where: { userId: r.userId, status: 'PUBLISHED', startsAt: { lt: r.endsAt }, endsAt: { gt: r.startsAt } } }),
        })),
      );
    });
    res.json(rows);
  }),
);

attendanceRouter.post(
  '/time-off/:id/decision',
  requirePermission('timeoff.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ decision: z.enum(['APPROVE', 'DENY']), note: z.string().max(500).nullable().optional() }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await tx.timeOffRequest.findUnique({ where: { id: uuid.parse(req.params.id) }, select: { userId: true } });
      if (r) await assertUserInScope(tx, a, r.userId);
      return withEvents(tx, decideTimeOff(tx, { userId: a.userId, tenantId: a.tenantId }, uuid.parse(req.params.id), body.decision, body.note));
    });
    dispatchSoon(a.tenantId);
    res.json({ status: out.status, reopenedShifts: out.reopenedShifts });
  }),
);

// ------------------------------------------------------------------ Punches
const punchInclude = {
  facility: { select: { id: true, name: true, timezone: true } },
  shift: { select: { id: true, startsAt: true, endsAt: true, position: { select: { name: true, nameFr: true } } } },
} as const;

attendanceRouter.get(
  '/me/punches',
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.timePunch.findMany({ where: { userId: a.userId, clockIn: { gte: q.from, lt: q.to } }, include: punchInclude, orderBy: { clockIn: 'desc' } }),
    );
    res.json(
      rows.map((p) => ({
        id: p.id,
        status: p.status,
        locationStatus: p.locationStatus,
        varianceReason: p.varianceReason,
        recordedOffline: p.recordedOffline,
        facility: p.facility,
        localClockIn: localIso(p.clockIn, p.facility.timezone),
        localClockOut: p.clockOut ? localIso(p.clockOut, p.facility.timezone) : null,
        hours: p.clockOut ? (p.clockOut.getTime() - p.clockIn.getTime()) / 3_600_000 : null,
        shift: p.shift && { id: p.shift.id, position: p.shift.position },
      })),
    );
  }),
);

attendanceRouter.get(
  '/me/punch/open',
  h(async (req, res) => {
    const a = authOf(req);
    const p = await withTenant(a.tenantId, (tx) => tx.timePunch.findFirst({ where: { userId: a.userId, clockOut: null }, include: punchInclude }));
    res.json(p ? { id: p.id, clockIn: p.clockIn, localClockIn: localIso(p.clockIn, p.facility.timezone), facility: p.facility, locationStatus: p.locationStatus, recordedOffline: p.recordedOffline, shift: p.shift } : null);
  }),
);

attendanceRouter.get(
  '/punches',
  requirePermission('timeclock.review'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'), facilityId: uuid.optional(), team: teamQuery }).parse(req.query);
    const rows = await withTenant(a.tenantId, async (tx) =>
      tx.timePunch.findMany({
        where: {
          status: q.status,
          ...(q.facilityId ? { facilityId: q.facilityId } : {}),
          user: peopleWhere(a.scope),
          ...(a.scope?.facilityIds.length ? { facilityId: { in: a.scope.facilityIds } } : {}),
          // "My team" only narrows what the permission already shows.
          ...(q.team ? { userId: { in: await teamOf(tx, a.userId) } } : {}),
        },
        include: { ...punchInclude, user: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { clockIn: 'asc' },
        take: 300,
      }),
    );
    const view = rows.map((p) => {
      const v = punchVariance(p);
      return {
        id: p.id,
        status: p.status,
        user: { id: p.user.id, name: `${p.user.firstName} ${p.user.lastName}` },
        facility: p.facility,
        localClockIn: localIso(p.clockIn, p.facility.timezone),
        localClockOut: p.clockOut ? localIso(p.clockOut, p.facility.timezone) : null,
        localShiftStart: p.shift ? localIso(p.shift.startsAt, p.facility.timezone) : null,
        localShiftEnd: p.shift ? localIso(p.shift.endsAt, p.facility.timezone) : null,
        hours: p.clockOut ? (p.clockOut.getTime() - p.clockIn.getTime()) / 3_600_000 : null,
        locationStatus: p.locationStatus,
        distanceM: p.distanceM,
        // Offline punches: when it happened (above) and when it reached us.
        recordedOffline: p.recordedOffline,
        localClockInReceivedAt: p.clockInReceivedAt ? localIso(p.clockInReceivedAt, p.facility.timezone) : null,
        localClockOutReceivedAt: p.clockOutReceivedAt ? localIso(p.clockOutReceivedAt, p.facility.timezone) : null,
        clockSkewS: p.clockSkewS,
        ...v,
      };
    });
    // Punches that need a look come first.
    view.sort((x, y) => y.attention.length - x.attention.length);
    res.json(view);
  }),
);

attendanceRouter.post(
  '/punches/decision',
  requirePermission('timeclock.review'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ ids: z.array(uuid).min(1).max(300), decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).nullable().optional() }).parse(req.body);
    if (new Set(body.ids).size !== body.ids.length) throw badRequest('Duplicate punch ids.');
    const out = await withTenant(a.tenantId, async (tx) => {
      if (a.scope) {
        const ps = await tx.timePunch.findMany({ where: { id: { in: body.ids } }, select: { userId: true, facilityId: true } });
        for (const p of ps) {
          await assertUserInScope(tx, a, p.userId);
          if (a.scope.facilityIds.length && !a.scope.facilityIds.includes(p.facilityId)) throw forbidden('This punch isn’t in your department.');
        }
      }
      const r = await decidePunches(tx, { userId: a.userId, tenantId: a.tenantId }, body.ids, body.decision, body.note);
      if (r.rejectedUserIds.length) {
        await recordEvents(tx, {
          type: 'notify',
          tenantId: a.tenantId,
          drafts: r.rejectedUserIds.map((userId) => ({ userId, type: 'punch_rejected', params: { note: body.note }, link: '/timeclock' })),
        });
      }
      return r;
    });
    if (out.rejectedUserIds.length) dispatchSoon(a.tenantId);
    res.json({ updated: out.updated });
  }),
);
