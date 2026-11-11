/**
 * FH Dev console: whether a city uses the public API and webhooks, and how much. Counts and
 * dates only: never a key, a secret, an address's path or a payload.
 */
import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { hasModule } from '../../services/billing/entitlements.js';
import { tenantSettings } from '../../services/platform/features.js';
import { h } from '../context.js';

export const platformIntegrationsRouter = Router();

platformIntegrationsRouter.get(
  '/tenants/:id/integrations',
  h(async (req, res) => {
    const tenantId = z.string().uuid().parse(req.params.id);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const now = new Date();
    const out = await withTenant(tenantId, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw notFound('Organization');
      const [keys, endpoints, deliveries] = await Promise.all([
        tx.apiKey.findMany({ select: { revokedAt: true, expiresAt: true, requestCount: true, lastUsedAt: true } }),
        tx.webhookEndpoint.findMany({ select: { url: true, enabled: true, disabledReason: true, events: true, lastSuccessAt: true, lastFailureAt: true } }),
        tx.webhookDelivery.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      ]);
      const active = keys.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > now));
      const count = (s: string) => deliveries.find((d) => d.status === s)?._count._all ?? 0;
      return {
        apiKeys: { active: active.length, total: keys.length, requests: keys.reduce((s, k) => s + k.requestCount, 0), lastUsedAt: keys.map((k) => k.lastUsedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null },
        webhooks: endpoints.map((e) => ({ host: new URL(e.url).host, enabled: e.enabled, disabledReason: e.disabledReason, events: e.events.length, lastSuccessAt: e.lastSuccessAt, lastFailureAt: e.lastFailureAt })),
        deliveries30d: { succeeded: count('SUCCEEDED'), failed: count('FAILED'), pending: count('PENDING') },
      };
    });
    res.json({ inPlan: hasModule((await tenantSettings(tenantId)).billing, 'publicApi'), ...out });
  }),
);
