/**
 * Fleet: city vehicles and the driver's pre-trip inspection. A major defect
 * takes the vehicle out of service until a supervisor records the repair; a
 * vehicle needs a passing inspection in the last 24 hours to be "ready".
 */
import type { Vehicle, VehicleInspection } from '../generated/prisma/client.js';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { h } from './context.js';

export const fleetRouter = Router();
fleetRouter.use(['/vehicles', '/inspections'], requireFeature('fleet'));
const uuid = z.string().uuid();

/** The pre-trip checklist, modelled on commercial vehicle daily inspection schedules. */
export const CHECKLIST = ['BRAKES', 'STEERING', 'LIGHTS', 'TIRES_WHEELS', 'HORN', 'WIPERS_WASHERS', 'MIRRORS_WINDOWS', 'FLUID_LEAKS', 'SEATBELTS', 'EMERGENCY_EQUIPMENT', 'COUPLING_HITCH', 'ATTACHMENTS'] as const;
const READY_MS = 24 * 3_600_000;

function view(v: Vehicle, last: VehicleInspection | null, now = Date.now()) {
  const fresh = !!last && now - last.at.getTime() < READY_MS && last.result !== 'MAJOR';
  return {
    id: v.id,
    unit: v.unit,
    description: v.description,
    plate: v.plate,
    facilityId: v.facilityId,
    certificationId: v.certificationId,
    active: v.active,
    outOfService: !!v.outOfServiceAt,
    outOfServiceReason: v.outOfServiceReason,
    outOfServiceAt: v.outOfServiceAt,
    lastInspection: last ? { at: last.at, result: last.result, userId: last.userId } : null,
    status: v.outOfServiceAt ? 'OUT_OF_SERVICE' : fresh ? 'READY' : 'NEEDS_INSPECTION',
  };
}

fleetRouter.get(
  '/vehicles',
  (req, res, next) => (req.auth?.permissions.has('fleet.inspect') || req.auth?.permissions.has('fleet.manage') ? next() : next(notFound('Page'))),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const vehicles = await tx.vehicle.findMany({ where: a.permissions.has('fleet.manage') ? {} : { active: true }, orderBy: { unit: 'asc' } });
      const last = await Promise.all(vehicles.map((v) => tx.vehicleInspection.findFirst({ where: { vehicleId: v.id }, orderBy: { at: 'desc' } })));
      return vehicles.map((v, i) => view(v, last[i]!));
    });
    res.json({ vehicles: out, checklist: CHECKLIST });
  }),
);

const vehicleBody = z.object({
  unit: z.string().trim().min(1).max(30),
  description: z.string().trim().min(2).max(120),
  plate: z.string().trim().max(15).nullable().optional(),
  facilityId: uuid.nullable().optional(),
  certificationId: uuid.nullable().optional(),
  active: z.boolean().optional(),
});

fleetRouter.post(
  '/vehicles',
  requirePermission('fleet.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = vehicleBody.parse(req.body);
    const v = await withTenant(a.tenantId, async (tx) => {
      if (await tx.vehicle.findFirst({ where: { unit: { equals: b.unit, mode: 'insensitive' } } })) throw conflict('UNIT_EXISTS', 'There is already a vehicle with that unit number.');
      return tx.vehicle.create({ data: { ...b, plate: b.plate ?? null, facilityId: b.facilityId ?? null, certificationId: b.certificationId ?? null, tenantId: a.tenantId } });
    });
    res.status(201).json(v);
  }),
);

fleetRouter.patch(
  '/vehicles/:id',
  requirePermission('fleet.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = vehicleBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.vehicle.findUnique({ where: { id } }))) throw notFound('Vehicle');
      await tx.vehicle.update({ where: { id }, data: b });
    });
    res.json({ ok: true });
  }),
);

/** The driver walks around the vehicle and records each item. */
fleetRouter.post(
  '/vehicles/:id/inspections',
  requirePermission('fleet.inspect'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z
      .object({
        odometerKm: z.number().int().min(0).max(5_000_000).nullable().optional(),
        items: z.array(z.object({ item: z.enum(CHECKLIST), ok: z.boolean(), severity: z.enum(['MINOR', 'MAJOR']).nullable().optional(), note: z.string().trim().max(300).nullable().optional() })).min(1).max(CHECKLIST.length),
        notes: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(req.body);
    const defects = b.items.filter((i) => !i.ok);
    if (defects.some((d) => !d.severity)) throw new HttpError(400, 'NEEDS_SEVERITY', 'Say whether each defect is minor or major.');
    const result = defects.some((d) => d.severity === 'MAJOR') ? 'MAJOR' : defects.length ? 'MINOR' : 'PASS';
    const out = await withTenant(a.tenantId, async (tx) => {
      const v = await tx.vehicle.findUnique({ where: { id } });
      if (!v || !v.active) throw notFound('Vehicle');
      // The driver must hold the licence the vehicle needs.
      if (v.certificationId) {
        const lic = await tx.userCertification.findFirst({ where: { userId: a.userId, certificationId: v.certificationId, OR: [{ expiryDate: null }, { expiryDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } }] } });
        if (!lic) throw new HttpError(403, 'LICENCE_REQUIRED', 'You need a valid licence on file for this vehicle.');
      }
      const ins = await tx.vehicleInspection.create({ data: { tenantId: a.tenantId, vehicleId: v.id, userId: a.userId, odometerKm: b.odometerKm ?? null, items: b.items, result, notes: b.notes ?? null } });
      if (result === 'MAJOR') {
        // Out of service until fixed: no one drives it.
        const reason = defects.filter((d) => d.severity === 'MAJOR').map((d) => (d.note ? `${d.item}: ${d.note}` : d.item)).join('; ');
        await tx.vehicle.update({ where: { id: v.id }, data: { outOfServiceAt: new Date(), outOfServiceReason: reason } });
        const to = await usersWithPermission(tx, a.tenantId, 'fleet.manage');
        await notify(tx, a.tenantId, to.map((userId) => ({ userId, type: 'vehicle_out_of_service', params: { unit: v.unit, reason }, link: '/manage/fleet', email: 'vehicle_out_of_service' })));
      } else if (result === 'MINOR') {
        const to = await usersWithPermission(tx, a.tenantId, 'fleet.manage');
        await notify(tx, a.tenantId, to.map((userId) => ({ userId, type: 'vehicle_minor_defect', params: { unit: v.unit }, link: '/manage/fleet' })));
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'vehicle.inspect', entity: 'Vehicle', entityId: v.id, after: { result, defects: defects.length } });
      return { id: ins.id, result };
    });
    res.status(201).json(out);
  }),
);

fleetRouter.get(
  '/vehicles/:id/inspections',
  requirePermission('fleet.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.vehicleInspection.findMany({ where: { vehicleId: id }, orderBy: { at: 'desc' }, take: 60 });
      const people = await tx.user.findMany({ where: { id: { in: [...new Set(list.map((l) => l.userId))] } }, select: { id: true, firstName: true, lastName: true } });
      return list.map((l) => ({ ...l, driver: people.find((p) => p.id === l.userId) ? `${people.find((p) => p.id === l.userId)!.firstName} ${people.find((p) => p.id === l.userId)!.lastName}` : '' }));
    });
    res.json(out);
  }),
);

/** A supervisor records the repair and puts the vehicle back in service. */
fleetRouter.post(
  '/vehicles/:id/return',
  requirePermission('fleet.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { note } = z.object({ note: z.string().trim().min(3).max(500) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const v = await tx.vehicle.findUnique({ where: { id } });
      if (!v) throw notFound('Vehicle');
      if (!v.outOfServiceAt) throw conflict('IN_SERVICE', 'This vehicle is already in service.');
      await tx.vehicle.update({ where: { id }, data: { outOfServiceAt: null, outOfServiceReason: null } });
      await tx.vehicleInspection.updateMany({ where: { vehicleId: id, result: 'MAJOR', repairedAt: null }, data: { repairedAt: new Date(), repairedById: a.userId, repairNote: note } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'vehicle.return', entity: 'Vehicle', entityId: id, after: { note } });
    });
    res.json({ ok: true });
  }),
);
