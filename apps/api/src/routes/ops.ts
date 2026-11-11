/** Pool operations: pools, headcounts, water-chemistry readings and their sign-off, and the incident list. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { localIso } from '../lib/time.js';
import { lifeguardsRequired } from '../services/ops/chemistry.js';
import { createPool, headcountBoard, headcountReport, poolDetailsBody, poolDetailsView, recordHeadcount, updatePool } from '../services/ops/pools.js';
import { h } from './context.js';
import { incidentsWhere } from '../services/people/scope.js';

export const opsRouter = Router();
const uuid = z.string().uuid();
const ppm = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable();


/** Pools with their thresholds, status, latest reading and lifeguards needed for the latest bather count. */
opsRouter.get(
  '/ops/pools',
  requirePermission('ops.status.read'),
  h(async (req, res) => {
    const a = authOf(req);
    // Retired pools stay out of deck screens; Settings asks for ?all=1 to list them too.
    const all = req.query.all === '1' && a.permissions.has('ops.configure');
    const pools = await withTenant(a.tenantId, (tx) =>
      tx.poolBody.findMany({
        where: all ? {} : { archivedAt: null },
        include: {
          facility: { select: { id: true, name: true, timezone: true } },
          readings: { orderBy: { recordedAt: 'desc' }, take: 1 },
          headcounts: { orderBy: { recordedAt: 'desc' }, take: 1 },
          closures: { where: { reopenedAt: null, dismissedAt: null }, orderBy: { recommendedAt: 'desc' }, take: 1 },
        },
        orderBy: [{ facility: { name: 'asc' } }, { name: 'asc' }],
      }),
    );
    res.json(
      pools.map((p) => {
        const last = p.readings[0];
        const count = p.headcounts[0];
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          status: p.status,
          facility: { id: p.facility.id, name: p.facility.name },
          configured: p.freeChlorineMinPpm !== null || p.phMin !== null,
          ...poolDetailsView(p),
          lastHeadcount: count ? { count: count.count, overCapacity: count.overCapacity, localRecordedAt: localIso(count.recordedAt, p.facility.timezone) } : null,
          thresholds: {
            freeChlorineMinPpm: p.freeChlorineMinPpm?.toString() ?? null,
            freeChlorineMaxPpm: p.freeChlorineMaxPpm?.toString() ?? null,
            combinedChlorineMaxPpm: p.combinedChlorineMaxPpm?.toString() ?? null,
            phMin: p.phMin?.toString() ?? null,
            phMax: p.phMax?.toString() ?? null,
            source: p.thresholdSource,
            bathersPerLifeguard: p.bathersPerLifeguard,
          },
          lastReading: last
            ? {
                id: last.id,
                localRecordedAt: localIso(last.recordedAt, p.facility.timezone),
                freeChlorinePpm: last.freeChlorinePpm?.toString() ?? null,
                ph: last.ph?.toString() ?? null,
                batherCount: last.batherCount,
                outOfRange: last.outOfRange,
                signedOff: last.signedOffAt !== null,
              }
            : null,
          // The latest deck headcount decides; older chemistry entries carried a bather count too.
          lifeguardsRequired: count ? lifeguardsRequired(count.count, p.bathersPerLifeguard) : last?.batherCount != null ? lifeguardsRequired(last.batherCount, p.bathersPerLifeguard) : null,
          openClosure: p.closures[0] ? { reason: p.closures[0].reason, confirmed: p.closures[0].confirmedAt !== null } : null,
        };
      }),
    );
  }),
);

const thresholdBody = z.object({
  freeChlorineMinPpm: ppm,
  freeChlorineMaxPpm: ppm,
  combinedChlorineMaxPpm: ppm,
  phMin: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable(),
  phMax: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable(),
  thresholdSource: z.string().min(3).max(200),
  bathersPerLifeguard: z.number().int().min(1).max(500).nullable(),
});

function checkThresholds(t: z.infer<typeof thresholdBody>) {
  const lt = (a: string | null, b: string | null) => a !== null && b !== null && Number(a) >= Number(b);
  if (lt(t.freeChlorineMinPpm, t.freeChlorineMaxPpm)) throw badRequest('Free chlorine minimum must be below the maximum.');
  if (lt(t.phMin, t.phMax)) throw badRequest('pH minimum must be below the maximum.');
  for (const v of [t.phMin, t.phMax]) if (v !== null && (Number(v) < 6 || Number(v) > 9)) throw badRequest('pH limits must be between 6 and 9.');
  if (t.freeChlorineMinPpm === null && t.phMin === null) throw badRequest('Set at least a free chlorine minimum or a pH range.');
}

opsRouter.post(
  '/ops/pools',
  requirePermission('ops.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    // Details now; permit limits now or later (Settings → Pools). If any limit is sent, all are checked.
    const body = poolDetailsBody.partial().required({ facilityId: true, name: true, kind: true }).parse(req.body);
    const sentLimits = Object.keys(thresholdBody.shape).some((k) => k in (req.body ?? {}) && k !== 'bathersPerLifeguard');
    const limits = sentLimits ? thresholdBody.parse(req.body) : null;
    if (limits) checkThresholds(limits);
    const p = await withTenant(a.tenantId, async (tx) => {
      const created = await createPool(tx, a.tenantId, { maxCapacity: null, bathersPerLifeguard: null, depthMinM: null, depthMaxM: null, volumeLitres: null, notes: null, ...body });
      if (limits) await tx.poolBody.update({ where: { id: created.id }, data: limits });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'pool.create', entity: 'PoolBody', entityId: created.id, after: body });
      return created;
    });
    res.status(201).json({ id: p.id });
  }),
);

opsRouter.patch(
  '/ops/pools/:id',
  requirePermission('ops.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = poolDetailsBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await updatePool(tx, id, body);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'pool.update', entity: 'PoolBody', entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------- Headcounts
/**
 * The deck's pools: capacity, permit limits set or not, latest headcount.
 * For anyone who records on deck (headcounts or water chemistry), not only leads.
 */
opsRouter.get(
  '/ops/headcounts/current',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('ops.headcount.record') && !a.permissions.has('ops.chemical.record')) throw forbidden();
    res.json(await withTenant(a.tenantId, headcountBoard));
  }),
);

opsRouter.post(
  '/ops/headcounts',
  requirePermission('ops.headcount.record'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ poolBodyId: uuid, count: z.number().int().min(0).max(10_000) }).parse(req.body);
    res.status(201).json(await withTenant(a.tenantId, (tx) => recordHeadcount(tx, a.tenantId, a.userId, body.poolBodyId, body.count)));
  }),
);

opsRouter.get(
  '/ops/headcounts',
  requirePermission('ops.headcount.record'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), poolBodyId: uuid.optional() }).parse(req.query);
    if (q.to.getTime() - q.from.getTime() > 93 * 86_400_000) throw badRequest('Choose a period of three months or less.');
    res.json(await withTenant(a.tenantId, (tx) => headcountReport(tx, q.from, q.to, q.poolBodyId)));
  }),
);

opsRouter.put(
  '/ops/pools/:id/thresholds',
  requirePermission('ops.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = thresholdBody.parse(req.body);
    checkThresholds(body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.poolBody.findUnique({ where: { id } });
      if (!before) throw notFound('Pool');
      await tx.poolBody.update({ where: { id }, data: body });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'pool.thresholds', entity: 'PoolBody', entityId: id, before, after: body });
    });
    res.json({ ok: true });
  }),
);

opsRouter.get(
  '/ops/readings',
  requirePermission('ops.chemical.record'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ poolBodyId: uuid.optional(), from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const readings = await tx.chemicalReading.findMany({
        where: { recordedAt: { gte: q.from, lt: q.to }, ...(q.poolBodyId ? { poolBodyId: q.poolBodyId } : {}) },
        include: { poolBody: { select: { id: true, name: true, facility: { select: { timezone: true } } } } },
        orderBy: { recordedAt: 'desc' },
        take: 500,
      });
      const ids = [...new Set(readings.flatMap((r) => [r.recordedById, r.signedOffById].filter((x): x is string => !!x)))];
      const people = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
      const name = (id: string | null) => {
        const p = people.find((x) => x.id === id);
        return p ? `${p.firstName} ${p.lastName.slice(0, 1)}.` : null;
      };
      return readings.map((r) => ({
        id: r.id,
        pool: { id: r.poolBody.id, name: r.poolBody.name },
        localRecordedAt: localIso(r.recordedAt, r.poolBody.facility.timezone),
        freeChlorinePpm: r.freeChlorinePpm?.toString() ?? null,
        totalChlorinePpm: r.totalChlorinePpm?.toString() ?? null,
        ph: r.ph?.toString() ?? null,
        waterTempC: r.waterTempC?.toString() ?? null,
        batherCount: r.batherCount,
        outOfRange: r.outOfRange,
        reasons: (r.outOfRangeDetails as string[] | null) ?? [],
        recordedBy: name(r.recordedById),
        signedOffBy: name(r.signedOffById),
      }));
    });
    res.json(rows);
  }),
);

/** Head lifeguard / supervisor confirms a reading was taken and reviewed. */
opsRouter.post(
  '/ops/readings/:id/signoff',
  requirePermission('ops.chemical.signoff'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.chemicalReading.findUnique({ where: { id } });
      if (!r) throw notFound('Reading');
      if (r.recordedById === a.userId) throw forbidden('Someone other than the person who took the reading signs it off.');
      await tx.chemicalReading.update({ where: { id }, data: { signedOffById: a.userId, signedOffAt: new Date() } });
    });
    res.json({ ok: true });
  }),
);

opsRouter.get(
  '/incidents',
  requirePermission('incidents.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    const rows = await withTenant(a.tenantId, async (tx) =>
      tx.incidentReport.findMany({
        where: { occurredAt: { gte: q.from, lt: q.to }, ...(await incidentsWhere(tx, a.scope)) },
        select: { id: true, category: true, occurredAt: true, reportedById: true, facility: { select: { id: true, name: true, timezone: true } }, _count: { select: { accessLog: true } } },
        orderBy: { occurredAt: 'desc' },
      }),
    );
    // Metadata only; reading the narrative goes through GET /incidents/:id with a stated purpose.
    res.json(
      rows.map((r) => ({
        id: r.id,
        category: r.category,
        localOccurredAt: localIso(r.occurredAt, r.facility.timezone),
        facility: { id: r.facility.id, name: r.facility.name },
        timesOpened: r._count.accessLog,
      })),
    );
  }),
);
