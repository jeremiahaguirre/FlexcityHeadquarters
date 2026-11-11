/** Deck rotation: stations, the live chair plan, rotating, and the log. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { applyRotation, loadPlan } from '../services/ops/rotation.js';
import { complianceSnapshot } from '../services/ops/compliance.js';
import { draftShiftsFor, forecastWeek, previewShiftsFor } from '../services/ops/forecast.js';
import { h } from './context.js';
import { facilitiesOf } from '../services/people/scope.js';

export const deckRouter = Router();
deckRouter.use(['/deck', '/me/deck'], requireFeature('rotations'));
// A lead limited to some facilities can't see or change other pools' decks.
deckRouter.use('/deck', (req, _res, next) => {
  const only = facilitiesOf(authOf(req).scope);
  const facilityId = (req.query.facilityId ?? (req.body as { facilityId?: unknown } | undefined)?.facilityId) as string | undefined;
  next(only && facilityId && !only.includes(facilityId) ? notFound('Facility') : undefined);
});
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

/** Compliance at any minute: rebuild the deck as it was at a past moment. Every report is logged. */
export const complianceRouter = Router();
complianceRouter.get(
  '/compliance/snapshot',
  requirePermission('compliance.report'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ facilityId: uuid, at: z.coerce.date() }).parse(req.query);
    if (q.at.getTime() > Date.now() + 60_000) throw notFound('A report for the future');
    facilityInScope(req, q.facilityId);
    const out = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: q.facilityId } }))) throw notFound('Facility');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'compliance.snapshot', entity: 'Facility', entityId: q.facilityId, after: { at: q.at.toISOString() } });
      return complianceSnapshot(tx, q.facilityId, q.at, a.scope?.positionIds.length ? a.scope.positionIds : null);
    });
    res.json(out);
  }),
);

/** Expected bathers and lifeguards needed per hour for a week, against who is scheduled. */
complianceRouter.get(
  '/forecast',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ facilityId: uuid, weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), positionId: uuid.optional() }).parse(req.query);
    facilityInScope(req, q.facilityId);
    positionInScope(req, q.positionId);
    res.json(await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: q.facilityId } }))) throw notFound('Facility');
      return forecastWeek(tx, q.facilityId, q.weekStart, q.positionId ?? null);
    }));
  }),
);

function facilityInScope(req: Parameters<typeof authOf>[0], facilityId: string) {
  const only = facilitiesOf(authOf(req).scope);
  if (only && !only.includes(facilityId)) throw notFound('Facility');
}
/** A lead limited to some positions forecasts and drafts shifts only for those. */
function positionInScope(req: Parameters<typeof authOf>[0], positionId: string | undefined) {
  const s = authOf(req).scope;
  if (positionId && s?.positionIds.length && !s.positionIds.includes(positionId)) throw notFound('Position');
}

/** A facility's opening hours by weekday, and the fewest lifeguards on deck while open. */
complianceRouter.get(
  '/facilities/:id/hours',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const facilityId = uuid.parse(req.params.id);
    facilityInScope(req, facilityId);
    res.json(await withTenant(a.tenantId, (tx) => tx.facilityHours.findMany({ where: { facilityId }, orderBy: [{ dayOfWeek: 'asc' }, { opensMinute: 'asc' }], select: { dayOfWeek: true, opensMinute: true, closesMinute: true, minGuards: true } })));
  }),
);

const block = z
  .object({ dayOfWeek: z.number().int().min(0).max(6), opensMinute: z.number().int().min(0).max(1439), closesMinute: z.number().int().min(1).max(1440), minGuards: z.number().int().min(0).max(50) })
  .refine((b) => b.closesMinute > b.opensMinute, { message: 'Closes after it opens' });

complianceRouter.put(
  '/facilities/:id/hours',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const facilityId = uuid.parse(req.params.id);
    facilityInScope(req, facilityId);
    const blocks = z.object({ blocks: z.array(block).max(70) }).parse(req.body).blocks;
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: facilityId } }))) throw notFound('Facility');
      const before = await tx.facilityHours.findMany({ where: { facilityId }, select: { dayOfWeek: true, opensMinute: true, closesMinute: true, minGuards: true } });
      await tx.facilityHours.deleteMany({ where: { facilityId } });
      if (blocks.length) await tx.facilityHours.createMany({ data: blocks.map((b) => ({ ...b, tenantId: a.tenantId, facilityId })) });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'facility.hours', entity: 'Facility', entityId: facilityId, before, after: blocks });
    });
    res.json({ blocks: blocks.length });
  }),
);

/** The week's gaps for one position as shifts to propose, nothing written (the Fill flow's preview). */
complianceRouter.post(
  '/forecast/preview-shifts',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ facilityId: uuid, weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), positionId: uuid }).parse(req.body);
    facilityInScope(req, b.facilityId);
    positionInScope(req, b.positionId);
    const shifts = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: b.facilityId } }))) throw notFound('Facility');
      if (!(await tx.position.findUnique({ where: { id: b.positionId } }))) throw notFound('Position');
      return previewShiftsFor(tx, b.facilityId, b.weekStart, b.positionId);
    });
    res.json({ shifts });
  }),
);

/** Creates the week's gaps for one position as draft open shifts, for the scheduler to review and fill. */
complianceRouter.post(
  '/forecast/draft-shifts',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ facilityId: uuid, weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), positionId: uuid }).parse(req.body);
    facilityInScope(req, b.facilityId);
    positionInScope(req, b.positionId);
    const created = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: b.facilityId } }))) throw notFound('Facility');
      if (!(await tx.position.findUnique({ where: { id: b.positionId } }))) throw notFound('Position');
      const shifts = await draftShiftsFor(tx, a.tenantId, b.facilityId, b.weekStart, b.positionId);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'forecast.draft_shifts', entity: 'Facility', entityId: b.facilityId, after: { weekStart: b.weekStart, positionId: b.positionId, shifts: shifts.length } });
      return shifts;
    });
    res.status(201).json({ created: created.length, shifts: created });
  }),
);
