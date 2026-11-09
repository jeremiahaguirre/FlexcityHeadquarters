/** Deck rotation: stations, the live chair plan, rotating, and the log. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { applyRotation, loadPlan } from '../services/ops/rotation.js';
import { h } from './context.js';

export const deckRouter = Router();
deckRouter.use(['/deck', '/me/deck'], requireFeature('rotations'));
const uuid = z.string().uuid();

deckRouter.get(
  '/deck/stations',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('deck.rotate') && !a.permissions.has('ops.configure')) throw forbidden();
    const facilityId = uuid.parse(req.query.facilityId);
    const rows = await withTenant(a.tenantId, (tx) => tx.deckStation.findMany({ where: { facilityId, ...(req.query.all === '1' ? {} : { archivedAt: null }) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }));
    res.json(rows);
  }),
);

const stationBody = z.object({ name: z.string().trim().min(1).max(60), poolBodyId: uuid.nullable().default(null), sortOrder: z.number().int().min(0).max(999).default(0) });

deckRouter.post(
  '/deck/stations',
  requirePermission('ops.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = stationBody.extend({ facilityId: uuid }).parse(req.body);
    const s = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: body.facilityId } }))) throw notFound('Facility');
      const created = await tx.deckStation.create({ data: { ...body, tenantId: a.tenantId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'deck.station.create', entity: 'DeckStation', entityId: created.id, after: body });
      return created;
    });
    res.status(201).json(s);
  }),
);

deckRouter.patch(
  '/deck/stations/:id',
  requirePermission('ops.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = stationBody.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.deckStation.findUnique({ where: { id } });
      if (!before) throw notFound('Station');
      const { archived, ...rest } = body;
      await tx.deckStation.update({ where: { id }, data: { ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'deck.station.update', entity: 'DeckStation', entityId: id, before, after: body });
    });
    res.json({ ok: true });
  }),
);

/** The live chair plan with the suggested next rotation. */
deckRouter.get(
  '/deck/plan',
  requirePermission('deck.rotate'),
  h(async (req, res) => {
    const a = authOf(req);
    const facilityId = uuid.parse(req.query.facilityId);
    res.json(await withTenant(a.tenantId, (tx) => loadPlan(tx, facilityId)));
  }),
);

deckRouter.post(
  '/deck/rotate',
  requirePermission('deck.rotate'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ facilityId: uuid, assignments: z.array(z.object({ stationId: uuid, userId: uuid.nullable() })).max(60) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await applyRotation(tx, a.tenantId, body.facilityId, a.userId, body.assignments);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'deck.rotate', entity: 'Facility', entityId: body.facilityId, after: body.assignments });
      return r;
    });
    res.json(out);
  }),
);

/** Close the deck: everyone comes off, the log is complete. */
deckRouter.post(
  '/deck/close',
  requirePermission('deck.rotate'),
  h(async (req, res) => {
    const a = authOf(req);
    const { facilityId } = z.object({ facilityId: uuid }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await tx.rotationLog.updateMany({ where: { facilityId, endedAt: null }, data: { endedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'deck.close', entity: 'Facility', entityId: facilityId });
    });
    res.json({ ok: true });
  }),
);

/** Rotation history for a period (who was where, when). */
deckRouter.get(
  '/deck/log',
  requirePermission('deck.rotate'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ facilityId: uuid, from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const logs = await tx.rotationLog.findMany({ where: { facilityId: q.facilityId, startedAt: { lt: q.to }, OR: [{ endedAt: null }, { endedAt: { gt: q.from } }] }, orderBy: { startedAt: 'asc' } });
      const [users, stations] = await Promise.all([
        tx.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.userId))] } }, select: { id: true, firstName: true, lastName: true } }),
        tx.deckStation.findMany({ where: { facilityId: q.facilityId } }),
      ]);
      return logs.map((l) => ({
        id: l.id,
        name: (() => { const u = users.find((x) => x.id === l.userId); return u ? `${u.firstName} ${u.lastName}` : '—'; })(),
        station: l.stationId ? stations.find((s) => s.id === l.stationId)?.name ?? '—' : null,
        startedAt: l.startedAt,
        endedAt: l.endedAt,
      }));
    });
    res.json(rows);
  }),
);

/** A lifeguard's own station right now. */
deckRouter.get(
  '/me/deck',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const log = await tx.rotationLog.findFirst({ where: { userId: a.userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
      if (!log) return null;
      const [station, facility] = await Promise.all([
        log.stationId ? tx.deckStation.findUnique({ where: { id: log.stationId } }) : null,
        tx.facility.findUniqueOrThrow({ where: { id: log.facilityId }, select: { rotationMinutes: true, name: true } }),
      ]);
      return { station: station?.name ?? null, facility: facility.name, startedAt: log.startedAt, dueAt: station ? new Date(log.startedAt.getTime() + facility.rotationMinutes * 60_000) : null };
    });
    res.json(out);
  }),
);
