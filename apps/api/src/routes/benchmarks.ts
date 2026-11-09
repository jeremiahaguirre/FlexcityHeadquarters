/** Benchmarks: this city's measures, and peers' quartiles if it shares too. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden } from '../lib/errors.js';
import { METRICS, MIN_CITIES, cityMetrics } from '../services/platform/benchmarks.js';
import { h } from './context.js';

export const benchmarksRouter = Router();
benchmarksRouter.use('/benchmarks', requireFeature('benchmarks'));

benchmarksRouter.get(
  '/benchmarks',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('tenant.configure') && !a.permissions.has('reliability.read')) throw forbidden();
    const out = await withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { benchmarkOptIn: true } });
      const mine = await cityMetrics(tx);
      let peers: Record<string, { p25: number; p50: number; p75: number; cities: number }> | null = null;
      if (t.benchmarkOptIn) {
        const rows = await tx.benchmarkSnapshot.findMany({ orderBy: { computedOn: 'desc' }, take: METRICS.length * 3 });
        peers = {};
        for (const k of METRICS) {
          const r = rows.find((x) => x.metric === k);
          if (r) peers[k] = { p25: r.p25, p50: r.p50, p75: r.p75, cities: r.cities };
        }
      }
      return { optedIn: t.benchmarkOptIn, minCities: MIN_CITIES, mine, peers };
    });
    res.json(out);
  }),
);

benchmarksRouter.put(
  '/benchmarks/opt-in',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: a.tenantId }, data: { benchmarkOptIn: on } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: on ? 'benchmarks.opt_in' : 'benchmarks.opt_out', entity: 'Tenant', entityId: a.tenantId });
    });
    res.json({ ok: true });
  }),
);
