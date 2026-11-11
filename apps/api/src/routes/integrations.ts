/**
 * Settings › Integrations: an organization's API keys and webhook endpoints (docs/PUBLIC-API.md).
 *
 * Administrators with tenant.configure manage them; making or rotating a key or a signing secret
 * needs a recent sign-in, and the secret is in that one answer only. A key can only be given
 * scopes whose data its maker can see. Plans without the option can look, not add
 * (403 PLAN_REQUIRED). Everything is in the audit log; secrets never are.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ApiKey, WebhookDelivery, WebhookEndpoint } from '@prisma/client';
import { authOf, requireModule, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import type { Permission } from '../auth/permissions.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { hasModule } from '../services/billing/entitlements.js';
import { type ApiScope, SCOPES, SCOPE_PERMISSIONS, newKey, parseIpEntry } from '../services/integrations/apiKeys.js';
import { WEBHOOK_EVENT_TYPES, attemptDelivery, checkWebhookUrl, newSigningSecret, redeliver, sealSecret, sendTestEvent } from '../services/integrations/webhooks.js';
import { tenantSettings } from '../services/platform/features.js';
import { h } from './context.js';

export const integrationsRouter = Router();
integrationsRouter.use('/integrations', requirePermission('tenant.configure'));

const MAX_KEYS = 25;
const MAX_ENDPOINTS = 10;
const ROTATION_OVERLAP_MS = 24 * 3_600_000;
const uuid = z.string().uuid();

const keyView = (k: ApiKey) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  allowedIps: k.allowedIps,
  expiresAt: k.expiresAt,
  lastUsedAt: k.lastUsedAt,
  lastUsedIp: k.lastUsedIp,
  requestCount: k.requestCount,
  rateLimitPerMinute: k.rateLimitPerMinute,
  createdAt: k.createdAt,
  revokedAt: k.revokedAt,
  status: k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt <= new Date() ? 'expired' : 'active',
});
const endpointView = (e: WebhookEndpoint) => ({
  id: e.id,
  url: e.url,
  description: e.description,
  events: e.events,
  enabled: e.enabled,
  disabledAt: e.disabledAt,
  disabledReason: e.disabledReason,
  consecutiveFailures: e.consecutiveFailures,
  lastSuccessAt: e.lastSuccessAt,
  lastFailureAt: e.lastFailureAt,
  createdAt: e.createdAt,
});
const deliveryView = (d: WebhookDelivery) => ({
  id: d.id,
  endpointId: d.endpointId,
  eventId: d.eventId,
  eventType: d.eventType,
  status: d.status,
  attempts: d.attempts,
  responseStatus: d.responseStatus,
  error: d.error,
  durationMs: d.durationMs,
  test: d.test,
  redelivery: !!d.redeliveryOfId,
  createdAt: d.createdAt,
  lastAttemptAt: d.lastAttemptAt,
  nextAttemptAt: d.status === 'PENDING' ? d.nextAttemptAt : null,
});

const mayGrant = (perms: Set<Permission>, scope: ApiScope) => SCOPE_PERMISSIONS[scope].some((p) => perms.has(p));

integrationsRouter.get(
  '/integrations',
  h(async (req, res) => {
    const a = authOf(req);
    const inPlan = hasModule((await tenantSettings(a.tenantId)).billing, 'publicApi');
    const [keys, endpoints] = await withTenant(a.tenantId, (tx) => Promise.all([tx.apiKey.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }), tx.webhookEndpoint.findMany({ orderBy: { createdAt: 'asc' } })]));
    res.json({
      inPlan,
      scopes: SCOPES.map((s) => ({ scope: s, allowed: mayGrant(a.permissions, s) })),
      events: WEBHOOK_EVENT_TYPES,
      keys: keys.map(keyView),
      webhooks: endpoints.map(endpointView),
    });
  }),
);

/* ---------- API keys ---------- */

const ipList = z
  .array(z.string().max(60))
  .max(50)
  .default([])
  .transform((list, ctx) => {
    const out: string[] = [];
    for (const raw of list.map((s) => s.trim()).filter(Boolean)) {
      const v = parseIpEntry(raw);
      if (!v) ctx.addIssue({ code: 'custom', message: `“${raw}” isn’t an IP address or range.` });
      else out.push(v);
    }
    return [...new Set(out)];
  });
const keyBody = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  allowedIps: ipList,
  expiresAt: z.string().datetime({ offset: true }).or(z.string().date()).nullable().default(null),
});

integrationsRouter.post(
  '/integrations/api-keys',
  requireModule('publicApi'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const b = keyBody.parse(req.body);
    const scopes = [...new Set(b.scopes)];
    const refused = scopes.filter((s) => !mayGrant(a.permissions, s));
    if (refused.length) throw new HttpError(403, 'SCOPE_NOT_YOURS', 'You can only give a key access to data you can see yourself.', { scopes: refused });
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw badRequest('Choose an expiry date in the future.');
    const k = newKey();
    const row = await withTenant(a.tenantId, async (tx) => {
      if ((await tx.apiKey.count({ where: { revokedAt: null } })) >= MAX_KEYS) throw new HttpError(409, 'TOO_MANY_KEYS', `An organization can have ${MAX_KEYS} keys. Revoke one you no longer use.`);
      const row = await tx.apiKey.create({ data: { tenantId: a.tenantId, name: b.name, prefix: k.prefix, keyHash: k.hash, scopes, allowedIps: b.allowedIps, expiresAt, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'api_key.create', entity: 'ApiKey', entityId: row.id, after: { name: b.name, prefix: k.prefix, scopes, allowedIps: b.allowedIps, expiresAt } });
      return row;
    });
    res.status(201).json({ key: k.key, apiKey: keyView(row) });
  }),
);

/** A new key with the same settings; the old one keeps working for a day, so systems can switch over. */
integrationsRouter.post(
  '/integrations/api-keys/:id/rotate',
  requireModule('publicApi'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const k = newKey();
    const row = await withTenant(a.tenantId, async (tx) => {
      const old = await tx.apiKey.findUnique({ where: { id } });
      if (!old || old.revokedAt || (old.expiresAt && old.expiresAt <= new Date())) throw notFound('API key');
      const refused = old.scopes.filter((s) => (SCOPES as readonly string[]).includes(s) && !mayGrant(a.permissions, s as ApiScope));
      if (refused.length) throw new HttpError(403, 'SCOPE_NOT_YOURS', 'This key reads data you can’t see yourself. Ask someone who can to rotate it.', { scopes: refused });
      const graceEnd = new Date(Date.now() + ROTATION_OVERLAP_MS);
      await tx.apiKey.update({ where: { id }, data: { expiresAt: old.expiresAt && old.expiresAt < graceEnd ? old.expiresAt : graceEnd } });
      const row = await tx.apiKey.create({ data: { tenantId: a.tenantId, name: old.name, prefix: k.prefix, keyHash: k.hash, scopes: old.scopes, allowedIps: old.allowedIps, expiresAt: old.expiresAt, rateLimitPerMinute: old.rateLimitPerMinute, createdById: a.userId, rotatedFromId: old.id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'api_key.rotate', entity: 'ApiKey', entityId: row.id, after: { from: old.id, oldPrefix: old.prefix, prefix: k.prefix, oldWorksUntil: graceEnd } });
      return row;
    });
    res.status(201).json({ key: k.key, apiKey: keyView(row) });
  }),
);

integrationsRouter.delete(
  '/integrations/api-keys/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: a.userId } });
      if (!done.count) throw notFound('API key');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'api_key.revoke', entity: 'ApiKey', entityId: id });
    });
    res.status(204).end();
  }),
);

/* ---------- Webhooks ---------- */

const events = z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length).transform((l) => [...new Set(l)]);
const endpointBody = z.object({ url: z.string().trim().url().max(500), description: z.string().trim().max(120).nullable().default(null), events });

integrationsRouter.post(
  '/integrations/webhooks',
  requireModule('publicApi'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const b = endpointBody.parse(req.body);
    await checkWebhookUrl(b.url);
    const secret = newSigningSecret();
    const sealed = await sealSecret(a.tenantId, secret);
    const row = await withTenant(a.tenantId, async (tx) => {
      if ((await tx.webhookEndpoint.count()) >= MAX_ENDPOINTS) throw new HttpError(409, 'TOO_MANY_ENDPOINTS', `An organization can have ${MAX_ENDPOINTS} webhook endpoints.`);
      const row = await tx.webhookEndpoint.create({ data: { tenantId: a.tenantId, url: b.url, description: b.description, events: b.events, secret: sealed, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'webhook.create', entity: 'WebhookEndpoint', entityId: row.id, after: { url: b.url, events: b.events } });
      return row;
    });
    res.status(201).json({ secret, webhook: endpointView(row) });
  }),
);

integrationsRouter.patch(
  '/integrations/webhooks/:id',
  requireModule('publicApi'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ url: endpointBody.shape.url.optional(), description: z.string().trim().max(120).nullable().optional(), events: events.optional(), enabled: z.boolean().optional() }).parse(req.body);
    if (b.url) await checkWebhookUrl(b.url);
    const row = await withTenant(a.tenantId, async (tx) => {
      const before = await tx.webhookEndpoint.findUnique({ where: { id } });
      if (!before) throw notFound('Webhook endpoint');
      const turningOn = b.enabled === true && !before.enabled;
      const row = await tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(b.url ? { url: b.url } : {}),
          ...(b.description !== undefined ? { description: b.description } : {}),
          ...(b.events ? { events: b.events } : {}),
          ...(b.enabled === false && before.enabled ? { enabled: false, disabledAt: new Date(), disabledReason: 'manual' } : {}),
          ...(turningOn ? { enabled: true, disabledAt: null, disabledReason: null, consecutiveFailures: 0 } : {}),
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'webhook.update', entity: 'WebhookEndpoint', entityId: id, before: { url: before.url, events: before.events, enabled: before.enabled }, after: b });
      return row;
    });
    res.json(endpointView(row));
  }),
);

/** A new signing secret; the old one also signs for a day, so receivers can switch over. */
integrationsRouter.post(
  '/integrations/webhooks/:id/rotate-secret',
  requireModule('publicApi'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const secret = newSigningSecret();
    const sealed = await sealSecret(a.tenantId, secret);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.webhookEndpoint.findUnique({ where: { id }, select: { secret: true } });
      if (!before) throw notFound('Webhook endpoint');
      await tx.webhookEndpoint.update({ where: { id }, data: { secret: sealed, previousSecret: before.secret as object, previousSecretUntil: new Date(Date.now() + ROTATION_OVERLAP_MS) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'webhook.rotate_secret', entity: 'WebhookEndpoint', entityId: id });
    });
    res.json({ secret });
  }),
);

integrationsRouter.delete(
  '/integrations/webhooks/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const e = await tx.webhookEndpoint.findUnique({ where: { id }, select: { url: true } });
      if (!e) throw notFound('Webhook endpoint');
      await tx.webhookEndpoint.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'webhook.delete', entity: 'WebhookEndpoint', entityId: id, before: { url: e.url } });
    });
    res.status(204).end();
  }),
);

integrationsRouter.post(
  '/integrations/webhooks/:id/test',
  requireModule('publicApi'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const ep = await withTenant(a.tenantId, (tx) => tx.webhookEndpoint.findUnique({ where: { id }, select: { id: true } }));
    if (!ep) throw notFound('Webhook endpoint');
    const deliveryId = await sendTestEvent(a.tenantId, id);
    const d = await withTenant(a.tenantId, async (tx) => {
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'webhook.test', entity: 'WebhookEndpoint', entityId: id, after: { deliveryId } });
      return tx.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    });
    res.json(deliveryView(d));
  }),
);

integrationsRouter.get(
  '/integrations/deliveries',
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ endpointId: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const rows = await withTenant(a.tenantId, (tx) => tx.webhookDelivery.findMany({ where: q.endpointId ? { endpointId: q.endpointId } : {}, orderBy: { createdAt: 'desc' }, take: q.limit }));
    res.json(rows.map(deliveryView));
  }),
);

integrationsRouter.post(
  '/integrations/deliveries/:id/redeliver',
  requireModule('publicApi'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const copy = await withTenant(a.tenantId, async (tx) => {
      const c = await redeliver(tx, a.tenantId, id);
      if (!c) throw notFound('Delivery');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'webhook.redeliver', entity: 'WebhookDelivery', entityId: id, after: { deliveryId: c.id } });
      return c;
    });
    await attemptDelivery(a.tenantId, copy.id);
    res.json(deliveryView(await withTenant(a.tenantId, (tx) => tx.webhookDelivery.findUniqueOrThrow({ where: { id: copy.id } }))));
  }),
);
